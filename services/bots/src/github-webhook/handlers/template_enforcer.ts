import {
  PullRequestEditedEvent,
  PullRequestOpenedEvent,
  PullRequestSynchronizeEvent,
} from '@octokit/webhooks-types';
import { EventType, HomeAssistantRepository } from '../github-webhook.const';
import { WebhookContext } from '../github-webhook.model';
import { extractTasks } from '../utils/text_parser';
import { BaseWebhookHandler } from './base';

// Keep in sync with the "Type of change" checkboxes in
// https://github.com/home-assistant/core/blob/dev/.github/PULL_REQUEST_TEMPLATE.md
const TYPE_OF_CHANGE_OPTIONS = new Set([
  'Dependency upgrade',
  'Bugfix (non-breaking change which fixes an issue)',
  'New integration (thank you!)',
  'New feature (which adds functionality to an existing integration)',
  'Deprecation (breaking change to happen in the future)',
  'Breaking change (fix/feature causing existing functionality to break)',
  'Code quality improvements to existing code or addition of tests',
]);

const UNDERSTANDING_CHECKBOX =
  'I understand the code I am submitting and can explain how it works.';

/**
 * Flags pull requests that never filled out the required PR template sections,
 * rather than trying to guess whether the text itself was AI-written.
 */
export class TemplateEnforcer extends BaseWebhookHandler {
  public allowedEventTypes = [
    EventType.PULL_REQUEST_OPENED,
    EventType.PULL_REQUEST_EDITED,
    EventType.PULL_REQUEST_SYNCHRONIZE,
  ];
  public allowedRepositories = [HomeAssistantRepository.CORE];

  async handle(
    context: WebhookContext<
      PullRequestOpenedEvent | PullRequestEditedEvent | PullRequestSynchronizeEvent
    >,
  ) {
    // PRs targeting `master` are maintainer-initiated backports, not community
    // contributions filling out the template, see docs_missing.ts for the same exemption.
    const isReleasePR = context.payload.pull_request.base.ref === 'master';
    const issue = isReleasePR ? undefined : this.findFirstIssue(context);

    await context.github.createCommitStatusWithRetry(
      context.repo({
        sha: context.payload.pull_request.head.sha,
        context: 'template-check',
        state: issue ? 'failure' : 'success',
        description: issue || 'PR template looks complete.',
      }),
    );
  }

  private findFirstIssue(context: WebhookContext<any>): string | undefined {
    const body = context.payload.pull_request.body || '';
    const checkedTasks = extractTasks(body).filter((task) => task.checked);

    const checkedTypeOfChange = checkedTasks.filter((task) =>
      TYPE_OF_CHANGE_OPTIONS.has(task.description),
    );
    if (checkedTypeOfChange.length === 0) {
      return 'Please check a "Type of change" box in the PR template.';
    }
    if (checkedTypeOfChange.length > 1) {
      return 'Please check only one "Type of change" box; split unrelated changes into separate PRs.';
    }

    if (!checkedTasks.some((task) => task.description === UNDERSTANDING_CHECKBOX)) {
      return 'Please confirm you understand the code you are submitting (see the checklist).';
    }

    const proposedChange = context.parsedMarkdown?.find(
      (section) => section.title === 'Proposed change',
    );
    if (!proposedChange?.text) {
      return 'Please describe your change in the "Proposed change" section.';
    }

    return undefined;
  }
}

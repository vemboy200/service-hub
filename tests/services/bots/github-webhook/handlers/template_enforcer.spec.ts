// @ts-nocheck
import * as assert from 'assert';
import { WebhookContext } from '../../../../../services/bots/src/github-webhook/github-webhook.model';
import { TemplateEnforcer } from '../../../../../services/bots/src/github-webhook/handlers/template_enforcer';
import { mockWebhookContext } from '../../../../utils/test_context';
import { loadJsonFixture } from '../../../../utils/fixture';

const COMPLETE_BODY = `
## Proposed change

This adds support for foo widgets by talking to their local API.

## Type of change

- [x] New feature (which adds functionality to an existing integration)

## Checklist

- [x] I understand the code I am submitting and can explain how it works.
`;

describe('TemplateEnforcer', () => {
  let handler: TemplateEnforcer;
  let mockContext: WebhookContext<any>;

  const buildContext = (body: string) =>
    mockWebhookContext({
      eventType: 'pull_request.opened',
      // The fixture's default base ref is `master`; use `dev` so these tests exercise
      // the normal community-PR path rather than the maintainer-backport exemption.
      payload: loadJsonFixture('pull_request.opened', {
        pull_request: { body, base: { ref: 'dev' } },
      }),
      github: {
        createCommitStatusWithRetry: jest.fn(),
      },
    });

  beforeEach(function () {
    handler = new TemplateEnforcer();
  });

  it('passes when the template is filled out correctly', async () => {
    mockContext = buildContext(COMPLETE_BODY);

    await handler.handle(mockContext);

    expect(mockContext.github.createCommitStatusWithRetry).toHaveBeenCalledWith({
      owner: 'Codertocat',
      repo: 'Hello-World',
      sha: 'ec26c3e57ca3a959ca5aad62de7213c562f8c821',
      context: 'template-check',
      state: 'success',
      description: 'PR template looks complete.',
    });
  });

  it('fails when no "Type of change" box is checked', async () => {
    mockContext = buildContext(
      COMPLETE_BODY.replace(
        '- [x] New feature (which adds functionality to an existing integration)',
        '- [ ] New feature (which adds functionality to an existing integration)',
      ),
    );

    await handler.handle(mockContext);

    const call = mockContext.github.createCommitStatusWithRetry.mock.calls[0][0];
    assert.strictEqual(call.state, 'failure');
    assert.ok(call.description.includes('Type of change'));
  });

  it('fails when more than one "Type of change" box is checked', async () => {
    mockContext = buildContext(
      COMPLETE_BODY.replace(
        '- [x] New feature (which adds functionality to an existing integration)',
        '- [x] New feature (which adds functionality to an existing integration)\n- [x] Bugfix (non-breaking change which fixes an issue)',
      ),
    );

    await handler.handle(mockContext);

    const call = mockContext.github.createCommitStatusWithRetry.mock.calls[0][0];
    assert.strictEqual(call.state, 'failure');
    assert.ok(call.description.includes('only one'));
  });

  it('fails when the understanding checklist item is not checked', async () => {
    mockContext = buildContext(
      COMPLETE_BODY.replace(
        '- [x] I understand the code I am submitting and can explain how it works.',
        '- [ ] I understand the code I am submitting and can explain how it works.',
      ),
    );

    await handler.handle(mockContext);

    const call = mockContext.github.createCommitStatusWithRetry.mock.calls[0][0];
    assert.strictEqual(call.state, 'failure');
    assert.ok(call.description.includes('understand the code'));
  });

  it('fails when the "Proposed change" section is left empty', async () => {
    mockContext = buildContext(
      COMPLETE_BODY.replace('This adds support for foo widgets by talking to their local API.', ''),
    );

    await handler.handle(mockContext);

    const call = mockContext.github.createCommitStatusWithRetry.mock.calls[0][0];
    assert.strictEqual(call.state, 'failure');
    assert.ok(call.description.includes('Proposed change'));
  });

  it('fails when the body is empty', async () => {
    mockContext = buildContext('');

    await handler.handle(mockContext);

    const call = mockContext.github.createCommitStatusWithRetry.mock.calls[0][0];
    assert.strictEqual(call.state, 'failure');
  });

  it('passes an empty-body PR targeting master (maintainer backport)', async () => {
    mockContext = mockWebhookContext({
      eventType: 'pull_request.opened',
      payload: loadJsonFixture('pull_request.opened', {
        pull_request: { body: '', base: { ref: 'master' } },
      }),
      github: {
        createCommitStatusWithRetry: jest.fn(),
      },
    });

    await handler.handle(mockContext);

    expect(mockContext.github.createCommitStatusWithRetry).toHaveBeenCalledWith({
      owner: 'Codertocat',
      repo: 'Hello-World',
      sha: 'ec26c3e57ca3a959ca5aad62de7213c562f8c821',
      context: 'template-check',
      state: 'success',
      description: 'PR template looks complete.',
    });
  });
});

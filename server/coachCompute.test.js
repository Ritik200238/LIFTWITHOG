import test from 'node:test';
import assert from 'node:assert/strict';

import { pickAttestedProviders, runOn0GCompute } from './coach-runtime.js';

/**
 * The claim, tested.
 *
 * Five documents and an agent card registered on chain as ERC-8004 #382 said
 * "attestation verified per response". The code read a flag off the marketplace
 * listing once, before the request, and never looked at the reply — so a
 * provider that was listed as attested and then answered from anywhere at all
 * was indistinguishable from one that had not. It also never called
 * `processResponse`, which is the same call that settles the fee, so the
 * inference was unpaid as well as unverified.
 *
 * These tests are the difference between the claim and the wording. Each one
 * asserts a way the answer must be thrown away rather than shown.
 */

/** A marketplace listing, in the positional shape `listService` returns. */
const listing = (provider, teeVerified) => {
  const tuple = new Array(11).fill(null);
  tuple[0] = provider;
  tuple[10] = teeVerified;
  return tuple;
};

/**
 * A broker that answers, with the verification verdict under the test's control.
 *
 * `fetch` is stubbed rather than the broker's own transport because the request
 * is a plain POST — pinning it here is what proves the usage JSON, and not the
 * answer, is what gets settled.
 */
function fakeBroker({ providers, verdicts, onProcess = () => {}, answer = 'Three sets of five.' }) {
  const asked = [];

  return {
    asked,
    broker: {
      inference: {
        listService: async () => providers,
        checkProviderSignerStatus: async () => ({ isAcknowledged: true, teeSignerAddress: '0xsigner' }),
        acknowledgeProviderSigner: async () => {},
        getServiceMetadata: async (provider) => ({
          endpoint: `https://${provider}.example`,
          model: 'a-model',
        }),
        getRequestHeaders: async () => ({ 'X-Phala-Signature-Type': 'test' }),
        processResponse: async (provider, chatId, content) => {
          asked.push(provider);
          onProcess({ provider, chatId, content });
          return verdicts[provider];
        },
      },
    },
    answer,
  };
}

function stubFetch(answer, { usage = { prompt_tokens: 10, completion_tokens: 4 }, chatIdHeader = 'chat-1' } = {}) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: (name) => (name.toLowerCase() === 'zg-res-key' ? chatIdHeader : null) },
    json: async () => ({ id: 'completion-1', usage, choices: [{ message: { content: answer } }] }),
  });
  return () => { globalThis.fetch = original; };
}

const run = (broker, opts) =>
  runOn0GCompute({ config: '{"sessions":3}', question: 'What next?' }, { createBroker: async () => broker, ...opts });

test('an answer the enclave vouches for is returned', async () => {
  const { broker } = fakeBroker({
    providers: [listing('0xaaa', true)],
    verdicts: { '0xaaa': true },
  });
  const restore = stubFetch('Three sets of five.');

  try {
    assert.equal(await run(broker), 'Three sets of five.');
  } finally {
    restore();
  }
});

test('an answer the enclave will not vouch for is thrown away, not shown', async () => {
  /*
   * The case a listing-time check cannot see: the marketplace says attested,
   * and then the response fails its own signature check. Before this, that
   * answer was returned and displayed under a TEE badge.
   */
  const { broker } = fakeBroker({
    providers: [listing('0xaaa', true)],
    verdicts: { '0xaaa': false },
  });
  const restore = stubFetch('Whatever I like.');

  try {
    await assert.rejects(
      () => run(broker),
      (error) => error.code === 'no_tee' && error.status === 503,
    );
  } finally {
    restore();
  }
});

test('a skipped verification is a refusal, because null does not mean yes', async () => {
  /*
   * `processResponse` returns null when no chat id was available, which the SDK
   * documents as verification *skipped*. A truthiness check would have called
   * that a pass; so would `!== false`. It is the quietest possible way to end
   * up fail-open, so it gets its own test.
   */
  const { broker } = fakeBroker({
    providers: [listing('0xaaa', true)],
    verdicts: { '0xaaa': null },
  });
  const restore = stubFetch('Unverifiable.', { chatIdHeader: null });

  try {
    await assert.rejects(() => run(broker), (error) => error.code === 'no_tee');
  } finally {
    restore();
  }
});

test('the fee is settled with the usage, not with the answer', async () => {
  /*
   * `processResponse` couples verification and billing, and its `content`
   * argument is the usage JSON. Handing it prose makes the fee parse fail
   * silently — the answer still arrives, nothing settles, and no error says so.
   */
  let settled = null;
  const { broker } = fakeBroker({
    providers: [listing('0xaaa', true)],
    verdicts: { '0xaaa': true },
    onProcess: ({ content, chatId }) => { settled = { content, chatId }; },
  });
  const restore = stubFetch('Three sets of five.');

  try {
    await run(broker);
    assert.deepEqual(JSON.parse(settled.content), { prompt_tokens: 10, completion_tokens: 4 });
    assert.ok(!settled.content.includes('Three sets'), 'the answer was settled instead of the usage');
    assert.equal(settled.chatId, 'chat-1', 'the id the signature covers comes from ZG-Res-Key');
  } finally {
    restore();
  }
});

test('a provider that will not vouch is followed by the next attested one', async () => {
  /*
   * One provider being out of balance says nothing about the next. Walking the
   * list cannot weaken anything, because the list was filtered to attested
   * before the first request was made.
   */
  const { broker, asked } = fakeBroker({
    providers: [listing('0xaaa', true), listing('0xbbb', true)],
    verdicts: { '0xaaa': false, '0xbbb': true },
  });
  const restore = stubFetch('From the second one.');

  try {
    assert.equal(await run(broker), 'From the second one.');
    assert.deepEqual(asked, ['0xaaa', '0xbbb']);
  } finally {
    restore();
  }
});

test('when every attested provider refuses, the request fails rather than falling back', async () => {
  // There is no unattested last resort, and this is the test that says so.
  const { broker } = fakeBroker({
    providers: [listing('0xaaa', true), listing('0xbbb', true)],
    verdicts: { '0xaaa': false, '0xbbb': false },
  });
  const restore = stubFetch('Nope.');

  try {
    await assert.rejects(
      () => run(broker),
      (error) => error.code === 'no_tee' && /does not run outside one/.test(error.message),
    );
  } finally {
    restore();
  }
});

test('an unattested provider is never asked, even when it is the only one', async () => {
  const { broker, asked } = fakeBroker({
    providers: [listing('0xaaa', false)],
    verdicts: { '0xaaa': true },
  });
  const restore = stubFetch('Should never be reached.');

  try {
    await assert.rejects(() => run(broker), (error) => error.code === 'no_tee');
    assert.deepEqual(asked, [], 'an unattested provider was contacted');
  } finally {
    restore();
  }
});

test('the provider list keeps only attested entries, in order, without repeats', () => {
  const providers = pickAttestedProviders([
    listing('0xaaa', true),
    listing('0xbbb', 'false'),
    listing('0xccc', true),
    listing('0xaaa', true),
    listing('0xddd', undefined),
  ]);

  // '0xbbb' reports the string "false", which is truthy and must not count.
  assert.deepEqual(providers, ['0xaaa', '0xccc']);
});

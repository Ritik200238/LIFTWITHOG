/*
 * The deployment check, checked by trying to fool it.
 *
 * A verifier that passes on real mainnet bytecode proves nothing about whether
 * it would notice a different contract. Most of these tests hand it something
 * subtly wrong — one flipped byte, a verifier slot holding another address, an
 * extra constructor argument — and require it to say so.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareRuntime,
  immutableAddress,
  sameAddress,
  matchesCreationInput,
  blockRanges,
  summarizeActivity,
  recordProblems,
  IMMUTABLE_SOURCES,
  shortString,
  eip712Immutables,
  expectedImmutable,
  immutableWord,
  eip712FromSource,
} from './deployment.mjs';
import { TypedDataEncoder } from 'ethers';

// A small runtime blob with one 32-byte immutable at offset 4, as the compiler
// leaves it (zeros) and as the chain holds it (an address written in).
const VERIFIER = '70c4de9d0edbe53733821558bf6b14b64451e56e';
const WORD = '000000000000000000000000' + VERIFIER;
const BUILT = '0x60806040' + '00'.repeat(32) + 'deadbeef';
const CHAIN = '0x60806040' + WORD + 'deadbeef';
const REFS = { 42: [{ start: 4, length: 32 }] };

test('identical code with a filled immutable is the same contract', () => {
  const r = compareRuntime(BUILT, CHAIN, REFS);
  assert.equal(r.identical, true);
  assert.deepEqual(r.immutables[42], ['0x' + WORD]);
});

test('one flipped byte outside the immutables is caught', () => {
  const tampered = CHAIN.slice(0, -2) + 'ee';
  const r = compareRuntime(BUILT, tampered, REFS);
  assert.equal(r.identical, false);
  assert.match(r.reason, /first difference at byte 39/);
});

test('without the immutable map the filled slot is a difference, not a pass', () => {
  // Masking is a decision the artifact makes, never one the checker assumes.
  assert.equal(compareRuntime(BUILT, CHAIN, {}).identical, false);
});

test('different lengths are a different contract, said plainly', () => {
  const r = compareRuntime(BUILT, CHAIN + 'aa', REFS);
  assert.equal(r.identical, false);
  assert.match(r.reason, /length differs/);
});

test('an immutable reads back as the address it holds', () => {
  const r = immutableAddress(['0x' + WORD, '0x' + WORD]);
  assert.equal(r.ok, true);
  assert.ok(sameAddress(r.address, '0x70c4dE9D0edbE53733821558Bf6b14b64451e56E'));
});

test('one immutable holding two different values is refused', () => {
  const other = '000000000000000000000000' + '11'.repeat(20);
  assert.equal(immutableAddress(['0x' + WORD, '0x' + other]).ok, false);
});

test('a slot that is not a left-padded address is refused', () => {
  assert.equal(immutableAddress(['0x' + 'ff'.repeat(32)]).ok, false);
});

test('address comparison ignores checksum case and refuses empties', () => {
  assert.ok(sameAddress('0xABCDEF0000000000000000000000000000000001', '0xabcdef0000000000000000000000000000000001'));
  assert.equal(sameAddress('', ''), false);
  assert.equal(sameAddress(undefined, undefined), false);
});

test('the deploy input must be creation code plus exactly these arguments', () => {
  const code = '0x6080604052';
  const args = '000000000000000000000000' + VERIFIER;
  assert.equal(matchesCreationInput(code + args, code, args).ok, true);
});

test('an extra or different constructor argument is caught', () => {
  const code = '0x6080604052';
  const args = '000000000000000000000000' + VERIFIER;
  const wrong = '000000000000000000000000' + '22'.repeat(20);
  assert.equal(matchesCreationInput(code + args + '00', code, args).ok, false);
  assert.equal(matchesCreationInput(code + wrong, code, args).ok, false);
});

test('creation code from a different build is caught', () => {
  assert.equal(matchesCreationInput('0x6080604053' + '00', '0x6080604052', '00').ok, false);
  assert.equal(matchesCreationInput('0x6080', '', '').ok, false);
});

test('block ranges cover the span exactly, in RPC-sized pieces', () => {
  assert.deepEqual(blockRanges(10, 25, 10), [[10, 19], [20, 25]]);
  assert.deepEqual(blockRanges(5, 5, 10), [[5, 5]]);
  assert.deepEqual(blockRanges(9, 3), []);
  const big = blockRanges(43_752_560, 43_900_000);
  assert.equal(big[0][0], 43_752_560);
  assert.equal(big.at(-1)[1], 43_900_000);
  assert.ok(big.every(([a, b]) => b - a + 1 <= 40_000));
});

test('activity is counted from events, lineage depth included', () => {
  const ev = (name, args, tx) => ({ name, args, tx, block: 1 });
  const s = summarizeActivity([
    ev('CoachMinted', { tokenId: 4 }, '0xa'),
    ev('CoachCloned', { parentId: 4, childId: 5 }, '0xb'),
    ev('CoachCloned', { parentId: 5, childId: 6 }, '0xc'),
    ev('CoachEvolved', { tokenId: 7, version: 2 }, '0xd'),
    ev('CoachEvolved', { tokenId: 7, version: 3 }, '0xe'),
    ev('IntelligentTransfer', {}, '0xf'),
  ]);
  assert.equal(s.minted, 1);
  assert.equal(s.clones, 2);
  // 5 descends from 4, 6 from 5: three generations counting the original.
  assert.equal(s.deepestLineage, 3);
  assert.equal(s.highestVersion, 3);
  assert.equal(s.intelligentTransfers, 1);
  assert.equal(s.rented, 0);
  assert.deepEqual(s.firstOf.clone, { tx: '0xb', block: 1 });
  assert.equal(s.firstOf.rent, null);
});

test('a record missing what makes it checkable is refused, every gap named', () => {
  const problems = recordProblems({ schemaVersion: 1, contracts: { CoachAgent: { address: '0x12' } } });
  for (const p of ['network.chainId', 'source.commit', 'deployer', 'contracts.CoachAgent.address', 'contracts.CoachAgent.deployTx']) {
    assert.ok(problems.includes(p), `expected ${p} to be named`);
  }
});

test('a short commit hash is not enough to rebuild from', () => {
  // The broadcast file stores seven characters. Seven characters are a lookup,
  // not a pin — the record has to carry the full hash.
  const r = recordProblems({ schemaVersion: 1, source: { commit: '55f46d4' } });
  assert.ok(r.includes('source.commit'));
});

/* -------------------------------------------- every immutable, accounted for */

const COACH = '0x94Ce4680890ab16B52E3F1A9CDf25C1B01e119B5';

test('ShortString is the bytes left-aligned with the length in the last byte', () => {
  assert.equal(shortString('1'), '0x31' + '00'.repeat(30) + '01');
  const name = shortString('LIFTWITHOG Coach');
  assert.equal(name.slice(2, 34), Buffer.from('LIFTWITHOG Coach').toString('hex'));
  assert.equal(name.slice(-2), '10'); // 16 bytes
  assert.equal(shortString('x'.repeat(32)), null);
});

test('the domain separator agrees with an independent EIP-712 implementation', () => {
  // ethers' TypedDataEncoder is a separate implementation of the same standard.
  // Agreeing with it is the evidence; agreeing with this file would be circular.
  const domain = { name: 'LIFTWITHOG Coach', version: '1', chainId: 16661, verifyingContract: COACH };
  assert.equal(eip712Immutables(domain).domainSeparator, TypedDataEncoder.hashDomain(domain));
});

test('the domain separator changes with every input, so it pins all four', () => {
  const base = { name: 'LIFTWITHOG Coach', version: '1', chainId: 16661, verifyingContract: COACH };
  const ds = eip712Immutables(base).domainSeparator;
  for (const change of [{ name: 'Other' }, { version: '2' }, { chainId: 16602 }, { verifyingContract: '0x' + '11'.repeat(20) }]) {
    assert.notEqual(eip712Immutables({ ...base, ...change }).domainSeparator, ds, JSON.stringify(change));
  }
});

test('an address immutable is the constructor argument, left-padded', () => {
  const rule = IMMUTABLE_SOURCES.CoachAgent.transferVerifier;
  const word = expectedImmutable(rule, { constructorArgs: { verifier: '0x70c4dE9D0edbE53733821558Bf6b14b64451e56E' } });
  assert.equal(word, '0x' + WORD);
});

test('an immutable with no rule has no expected value, so it cannot pass', () => {
  assert.equal(expectedImmutable(undefined, {}), null);
  assert.equal(expectedImmutable({ constructorArg: 'missing' }, { constructorArgs: {} }), null);
});

test('every EIP712 immutable CoachAgent has is named with a rule', () => {
  // The seven OpenZeppelin caches, plus the verifier. If OpenZeppelin adds one,
  // this list is where it has to be explained.
  for (const name of ['transferVerifier', '_cachedDomainSeparator', '_cachedChainId', '_cachedThis', '_hashedName', '_hashedVersion', '_name', '_version']) {
    assert.ok(IMMUTABLE_SOURCES.CoachAgent[name], name);
  }
});

test('an immutable must hold one value in every slot', () => {
  const w = '0x' + WORD;
  assert.equal(immutableWord([w, w]).word, w);
  assert.equal(immutableWord([w, '0x' + '11'.repeat(32)]).ok, false);
  assert.equal(immutableWord(['0x1234']).ok, false);
});

test('the EIP712 name and version are read from the constructor in the source', () => {
  const src = 'constructor(address v) ERC721("LIFTWITHOG Coach", "COACH") EIP712("LIFTWITHOG Coach", "1") {';
  assert.deepEqual(eip712FromSource(src), { name: 'LIFTWITHOG Coach', version: '1' });
  assert.equal(eip712FromSource('contract NoDomain {}'), null);
});

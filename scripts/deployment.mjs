/**
 * What a deployment record claims, and how each claim is checked.
 *
 * Shared by the script that writes `deployments/<chainId>.json` and the one that
 * checks it, so the two cannot disagree about what "the same contract" means.
 * Everything here is a pure function of its inputs — no RPC, no filesystem —
 * which is what lets the tests break it on purpose.
 *
 * Three different questions get asked of a deployed contract, and they are kept
 * apart because each one catches something the others cannot:
 *
 *   creation input  — does the deploy transaction contain exactly the compiled
 *                     creation code followed by the constructor arguments we
 *                     say? This is the strongest single check: it pins the
 *                     source, the compiler settings and the arguments at once.
 *   runtime code    — does the code now at the address match the compiled
 *                     runtime code, byte for byte, outside the slots the
 *                     constructor fills in?
 *   immutables      — are those slots filled with the values we say? A runtime
 *                     comparison that masks them and stops there would accept a
 *                     coach wired to any verifier at all.
 */

import { AbiCoder, keccak256, toUtf8Bytes, hexlify, zeroPadValue, toBeHex } from 'ethers';

const strip = (hex) => String(hex ?? '').toLowerCase().replace(/^0x/, '');

/**
 * Where every immutable in every deployed contract gets its value.
 *
 * The runtime comparison masks immutables, because the compiler leaves them
 * empty and the constructor fills them. Masking is only honest if every masked
 * byte is then accounted for — so each immutable is named here with the rule
 * that produces its value, and one that is not named fails the check instead
 * of being waved through.
 *
 * CoachAgent carries eight: the verifier it is wired to, and seven that
 * OpenZeppelin's EIP712 caches at construction — the chain, the contract's own
 * address, the hashed name and version, the domain separator built from them,
 * and the name and version themselves. The first version of this check assumed
 * every immutable was a constructor address, and failed on all seven.
 */
export const IMMUTABLE_SOURCES = {
  AttestedTransferVerifier: {
    attestor: { constructorArg: 'attestor_' },
  },
  CoachAgent: {
    transferVerifier: { constructorArg: 'verifier' },
    _cachedDomainSeparator: { eip712: 'domainSeparator' },
    _cachedChainId: { eip712: 'chainId' },
    _cachedThis: { eip712: 'verifyingContract' },
    _hashedName: { eip712: 'hashedName' },
    _hashedVersion: { eip712: 'hashedVersion' },
    _name: { eip712: 'shortName' },
    _version: { eip712: 'shortVersion' },
  },
};

/**
 * OpenZeppelin's ShortString: the string's bytes left-aligned in a word, with
 * its length in the last byte. Anything over 31 bytes goes to storage instead
 * and the immutable holds a sentinel — not a case this contract has, so it is
 * refused here rather than modelled.
 */
export function shortString(str) {
  const bytes = toUtf8Bytes(str);
  if (bytes.length > 31) return null;
  const word = new Uint8Array(32);
  word.set(bytes, 0);
  word[31] = bytes.length;
  return hexlify(word);
}

/**
 * Every value OpenZeppelin's EIP712 constructor writes, computed from what the
 * source says the name and version are and where the contract is.
 *
 * The domain separator is rebuilt here from its definition rather than read
 * off the chain: the point is to show the stored one is what those inputs
 * produce, not that it equals itself.
 */
export function eip712Immutables({ name, version, chainId, verifyingContract }) {
  const hashedName = keccak256(toUtf8Bytes(name));
  const hashedVersion = keccak256(toUtf8Bytes(version));
  const typeHash = keccak256(toUtf8Bytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'));
  const domainSeparator = keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
      [typeHash, hashedName, hashedVersion, chainId, verifyingContract],
    ),
  );
  return {
    domainSeparator,
    chainId: zeroPadValue(toBeHex(chainId), 32),
    verifyingContract: zeroPadValue(verifyingContract, 32),
    hashedName,
    hashedVersion,
    shortName: shortString(name),
    shortVersion: shortString(version),
  };
}

/** The word an immutable should hold, or null when its rule cannot be applied. */
export function expectedImmutable(rule, { constructorArgs = {}, eip712 = {} } = {}) {
  if (!rule) return null;
  if (rule.constructorArg) {
    const value = constructorArgs[rule.constructorArg];
    return /^0x[0-9a-fA-F]{40}$/.test(String(value ?? '')) ? zeroPadValue(value, 32).toLowerCase() : null;
  }
  if (rule.eip712) return eip712[rule.eip712] ? String(eip712[rule.eip712]).toLowerCase() : null;
  return null;
}

/**
 * The single value an immutable holds across all its slots.
 *
 * An immutable read in three places is written in three places, and all three
 * must agree; a disagreement is not something any compiler emits.
 */
export function immutableWord(occurrences) {
  const unique = [...new Set((occurrences ?? []).map((w) => '0x' + strip(w)))];
  if (unique.length !== 1) return { ok: false, reason: `${unique.length} distinct values across ${occurrences?.length ?? 0} slots` };
  if (unique[0].length !== 66) return { ok: false, reason: 'not a 32-byte word' };
  return { ok: true, word: unique[0] };
}

/** The EIP712 name and version a contract's constructor passes, read from its source. */
export function eip712FromSource(solidity) {
  const m = String(solidity).match(/EIP712\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*\)/);
  return m ? { name: m[1], version: m[2] } : null;
}

/**
 * Split runtime code into the part the compiler decided and the part the
 * constructor wrote.
 *
 * `immutableReferences` comes straight from the compiler artifact: for each
 * immutable, the byte offsets it occupies. The compiler leaves zeros there; the
 * constructor overwrites them at deploy time. Those bytes are the only ones
 * allowed to differ, and only because we then check what they contain.
 */
export function compareRuntime(builtHex, chainHex, immutableReferences = {}) {
  const built = strip(builtHex);
  const chain = strip(chainHex);

  if (built.length !== chain.length) {
    return { identical: false, reason: `length differs: built ${built.length / 2} B, chain ${chain.length / 2} B`, immutables: {} };
  }

  const a = built.split('');
  const b = chain.split('');
  const immutables = {};

  for (const [id, slots] of Object.entries(immutableReferences)) {
    immutables[id] = [];
    for (const { start, length } of slots) {
      immutables[id].push('0x' + chain.slice(start * 2, (start + length) * 2));
      for (let i = start * 2; i < (start + length) * 2; i += 1) {
        a[i] = '0';
        b[i] = '0';
      }
    }
  }

  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return { identical: false, reason: `first difference at byte ${Math.floor(i / 2)}`, immutables };
    }
  }
  return { identical: true, reason: null, immutables };
}

/**
 * The value an immutable slot holds, read as the address it should be.
 *
 * An immutable `address` occupies a full 32-byte word, left-padded. Every
 * occurrence of one immutable must hold the same value — two different values
 * in two slots of the same variable is not a contract any compiler produced.
 */
export function immutableAddress(occurrences) {
  const unique = [...new Set((occurrences ?? []).map((w) => strip(w)))];
  if (unique.length !== 1) return { ok: false, reason: `${unique.length} distinct values across ${occurrences?.length ?? 0} slots` };
  const word = unique[0];
  if (word.length !== 64 || !/^0{24}/.test(word)) return { ok: false, reason: 'not a left-padded address' };
  return { ok: true, address: '0x' + word.slice(24) };
}

/** Same address, ignoring checksum case. */
export const sameAddress = (a, b) => strip(a) !== '' && strip(a) === strip(b);

/**
 * The deploy transaction's input is creation code followed by the ABI-encoded
 * constructor arguments, and nothing else.
 *
 * `encodedArgs` is passed in already encoded, so this stays free of any ABI
 * library and the caller decides what the arguments were meant to be.
 */
export function matchesCreationInput(txInputHex, creationBytecodeHex, encodedArgsHex = '') {
  const input = strip(txInputHex);
  const code = strip(creationBytecodeHex);
  const args = strip(encodedArgsHex);

  if (!code) return { ok: false, reason: 'no creation bytecode to compare against' };
  if (!input.startsWith(code)) return { ok: false, reason: 'the deploy input does not begin with the compiled creation code' };
  const onChain = input.slice(code.length);
  if (onChain !== args) {
    return {
      ok: false,
      reason: onChain.length === args.length
        ? `the constructor arguments differ: the chain has 0x${onChain}, the record implies 0x${args}`
        : `the constructor arguments differ in length: ${onChain.length / 2} B on chain, ${args.length / 2} B expected`,
    };
  }
  return { ok: true, reason: null };
}

/**
 * Block ranges small enough for a public RPC's log limit.
 *
 * 0G's public endpoint refuses `eth_getLogs` spans much past fifty thousand
 * blocks, and the failure arrives as an error rather than as an empty result —
 * so a record built from one big query is a record that works for a week and
 * then cannot be rebuilt at all.
 */
export function blockRanges(from, to, size = 40_000) {
  if (!(Number.isInteger(from) && Number.isInteger(to)) || from > to || size < 1) return [];
  const out = [];
  for (let start = from; start <= to; start += size) out.push([start, Math.min(start + size - 1, to)]);
  return out;
}

/**
 * Turn decoded events into the activity section of the record.
 *
 * Counted from the chain rather than listed by hand, because the list that was
 * typed by hand is the one that went stale: the README linked six transactions
 * while twelve had happened, and the policy record kept naming a testnet
 * anchor for a week after the mainnet one existed.
 */
export function summarizeActivity(events) {
  const count = (name) => events.filter((e) => e.name === name).length;
  const first = (name) => events.find((e) => e.name === name) ?? null;

  const evolved = events.filter((e) => e.name === 'CoachEvolved');
  const highestVersion = evolved.reduce((max, e) => Math.max(max, Number(e.args?.version ?? 0)), 1);

  const clones = events.filter((e) => e.name === 'CoachCloned');
  const parentOf = new Map(clones.map((e) => [String(e.args.childId), String(e.args.parentId)]));
  let deepest = clones.length ? 1 : 0;
  for (const child of parentOf.keys()) {
    let depth = 1;
    let node = child;
    while (parentOf.has(node)) { node = parentOf.get(node); depth += 1; }
    deepest = Math.max(deepest, depth);
  }

  const sample = (e) => (e ? { tx: e.tx, block: e.block } : null);

  return {
    minted: count('CoachMinted'),
    evolved: evolved.length,
    highestVersion,
    listedForRent: count('RentalPriceSet'),
    rented: count('Rented'),
    intelligentTransfers: count('IntelligentTransfer'),
    clones: clones.length,
    deepestLineage: deepest,
    firstOf: {
      mint: sample(first('CoachMinted')),
      evolve: sample(first('CoachEvolved')),
      listing: sample(first('RentalPriceSet')),
      rent: sample(first('Rented')),
      transfer: sample(first('IntelligentTransfer')),
      clone: sample(first('CoachCloned')),
    },
  };
}

/**
 * The shape a record must have before anything in it is worth checking.
 *
 * Returns every problem at once rather than the first, because a record
 * somebody is repairing by hand should not need one run per missing field.
 */
export function recordProblems(record) {
  const problems = [];
  const need = (path, test) => {
    const value = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), record);
    if (!test(value)) problems.push(path);
  };
  const isAddress = (v) => /^0x[0-9a-fA-F]{40}$/.test(String(v ?? ''));
  const isHash = (v) => /^0x[0-9a-fA-F]{64}$/.test(String(v ?? ''));
  const isBlock = (v) => Number.isInteger(v) && v > 0;

  need('schemaVersion', (v) => v === 1);
  need('network.chainId', (v) => Number.isInteger(v));
  need('network.rpc', (v) => /^https:\/\//.test(String(v ?? '')));
  need('source.commit', (v) => /^[0-9a-f]{40}$/.test(String(v ?? '')));
  need('source.compiler', (v) => /^\d+\.\d+\.\d+\+commit\.[0-9a-f]{8}$/.test(String(v ?? '')));
  need('deployer', isAddress);

  for (const name of Object.keys(record?.contracts ?? {})) {
    need(`contracts.${name}.address`, isAddress);
    need(`contracts.${name}.deployTx`, isHash);
    need(`contracts.${name}.block`, isBlock);
    need(`contracts.${name}.runtimeCodeHash`, isHash);
  }
  if (!record?.contracts || Object.keys(record.contracts).length === 0) problems.push('contracts');

  return problems;
}

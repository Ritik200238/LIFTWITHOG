#!/usr/bin/env node
/**
 * Rent a coach on chain, and show the money went straight to its owner.
 *
 *   node --env-file=server/.env scripts/prove-rent.mjs [tokenId] [days]
 *
 * The claim this backs is the one the market rests on: access and payment are
 * the same transaction, the owner is paid inside it, and the contract keeps
 * nothing. The balances are read before and after, from the chain, rather than
 * inferred from the event — an event says what the contract meant to do, a
 * balance says what it did.
 *
 * The renter here is the relayer wallet, because renting costs money and a
 * walletless device has none. That is deliberate in the product too: minting,
 * evolving and listing are paid for you; buying somebody else's method is not.
 */
import { ethers } from 'ethers';

const RPC = process.env.OG_RPC_URL || 'https://evmrpc-testnet.0g.ai';
const CHAIN_ID = +(process.env.OG_CHAIN_ID || (RPC === 'https://evmrpc.0g.ai' ? 16661 : 16602));
const EXPLORER = CHAIN_ID === 16661 ? 'https://chainscan.0g.ai' : 'https://chainscan-galileo.0g.ai';
const COACH = process.env.COACH_ADDRESS;
const KEY = process.env.RELAYER_PRIVATE_KEY || process.env.COACH_SERVICE_KEY;
if (!COACH || !KEY) {
  console.error('Set COACH_ADDRESS and RELAYER_PRIVATE_KEY (try --env-file=server/.env).');
  process.exit(1);
}

const tokenId = BigInt(process.argv[2] ?? 1);
const days = BigInt(process.argv[3] ?? 1);

const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true });
const renter = new ethers.Wallet(KEY, provider);
const coach = new ethers.Contract(COACH, [
  'function rentalPrice(uint256) view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function isAuthorizedUser(uint256,address) view returns (bool)',
  'function rent(uint256 tokenId, uint256 dayCount) payable',
], renter);

const price = await coach.rentalPrice(tokenId);
if (price === 0n) {
  console.error(`Coach #${tokenId} is not listed for rent.`);
  process.exit(1);
}
const owner = await coach.ownerOf(tokenId);
const cost = price * days;

const ownerBefore = await provider.getBalance(owner);
const contractBefore = await provider.getBalance(COACH);

console.log(`chain     ${CHAIN_ID}`);
console.log(`coach     #${tokenId}, owned by ${owner}`);
console.log(`price     ${ethers.formatEther(price)} 0G / day × ${days} = ${ethers.formatEther(cost)} 0G`);
console.log(`renter    ${renter.address}`);
console.log(`\nowner holds ${ethers.formatEther(ownerBefore)} 0G before`);

process.stdout.write('renting… ');
const tx = await coach.rent(tokenId, days, { value: cost, gasPrice: 6_000_000_000n });
const receipt = await tx.wait();
console.log(`done\n  ${EXPLORER}/tx/${receipt.hash}`);

const ownerAfter = await provider.getBalance(owner);
const contractAfter = await provider.getBalance(COACH);
const access = await coach.isAuthorizedUser(tokenId, renter.address);

console.log('\nread back from the chain:');
console.log(`  owner received     ${ethers.formatEther(ownerAfter - ownerBefore)} 0G   (price was ${ethers.formatEther(cost)})`);
console.log(`  contract balance   ${ethers.formatEther(contractBefore)} → ${ethers.formatEther(contractAfter)} 0G`);
console.log(`  renter has access  ${access}`);

const ok = ownerAfter - ownerBefore === cost && contractAfter === 0n && access;
console.log(ok
  ? '\n✓ paid in full to the owner, in the transaction that granted access; the contract kept nothing.'
  : '\n✗ something did not hold — read the lines above.');
process.exit(ok ? 0 : 1);

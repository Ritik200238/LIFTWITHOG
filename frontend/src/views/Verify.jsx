/**
 * The page for somebody who does not believe us.
 *
 * Proof is personal: it shows *your* coach, *your* device, and to a stranger
 * with no coach it says "you have not created one yet" — which proves nothing
 * to the one person most worth convincing. This page assumes no account, no
 * coach, and no goodwill.
 *
 * Every claim here is one of three things: read live from 0G while you watch,
 * a link to a public explorer, or a command you can run against this repository
 * yourself. Nothing is asserted that cannot be checked from outside.
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { COACH_ADDRESS } from '../lib/coachConfig.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

const EXPLORER = 'https://chainscan-galileo.0g.ai'
const REPO = 'https://github.com/Ritik200238/LIFTWITHOG'

/** A claim, and the thing that settles it. */
function Claim({ title, children, evidence }) {
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
        <Icon name="checkCircle" style={{ color: 'var(--acc)', marginTop: 2, flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
          <div className="muted small" style={{ lineHeight: 1.45 }}>{children}</div>
          {evidence && (
            <div className="small" style={{ marginTop: 8, wordBreak: 'break-all' }}>{evidence}</div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Something to copy and run. */
function Command({ children }) {
  return (
    <pre
      className="small"
      style={{
        background: 'var(--surface-2)',
        padding: '10px 12px',
        borderRadius: 8,
        overflowX: 'auto',
        margin: '8px 0 0',
        whiteSpace: 'pre',
      }}
    >
      <code>{children}</code>
    </pre>
  )
}

/*
 * `.taplink` rather than a bare anchor: a 17px-tall line of text is a link a
 * thumb misses, and these are the links the whole page exists to be clicked.
 */
const Link = ({ href, children }) => (
  <a className="taplink" href={href} target="_blank" rel="noreferrer noopener">{children}</a>
)

/**
 * The interface ids to ask about, and what each answer ought to be.
 *
 * `0xdeadbeef` is the one that carries the argument. It is not an interface
 * anybody implements, so a correct contract says false — and a stub written to
 * look compliant, which returns true for whatever it is handed, is caught by
 * exactly one line on this page. Without it the four rows above prove only that
 * `supportsInterface` exists.
 */
const INTERFACES = [
  { id: '0x4b396f04', label: 'ERC-7857 — an Agentic ID', expect: true },
  { id: '0x35d39512', label: 'ERC-7857 Authorize — lending it out', expect: true },
  { id: '0x80ac58cd', label: 'ERC-721 — still an NFT', expect: true },
  { id: '0x01ffc9a7', label: 'ERC-165 — answers this question at all', expect: true },
  { id: '0xdeadbeef', label: 'an id nothing implements — the control', expect: false },
]

/** One asked-and-answered interface, right when the answer matches expectation. */
function InterfaceRow({ id, label, expect, answered }) {
  const right = answered === expect
  const unknown = answered === null

  return (
    <div
      className="row small"
      style={{ justifyContent: 'space-between', gap: 12, padding: '6px 0', alignItems: 'baseline' }}
    >
      <div style={{ minWidth: 0 }}>
        <code style={{ fontSize: 12 }}>{id}</code>
        <div className="dim" style={{ fontSize: 12 }}>{t(label)}</div>
      </div>
      <div
        style={{
          whiteSpace: 'nowrap',
          fontWeight: 600,
          // Correct-because-false has to read as a pass, or the control looks
          // like the one thing on the page that went wrong.
          color: unknown ? 'var(--dim)' : right ? 'var(--acc)' : 'var(--bad, #d33)',
        }}
      >
        {unknown ? t('no answer') : String(answered)} {unknown ? '' : right ? '✓' : '✗'}
      </div>
    </div>
  )
}

export default function Verify() {
  const nav = useNavigate()
  const [chain, setChain] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        /*
         * Loaded on demand rather than imported at the top, so opening any
         * other screen in this app never pays for ethers. This page is the one
         * place that genuinely needs a chain connection to do its job.
         */
        const { readProvider } = await import('../lib/marketplace.js')
        const { coachContract } = await import('../lib/ogCoach.js')

        const provider = readProvider()
        const [network, block] = await Promise.all([provider.getNetwork(), provider.getBlockNumber()])

        const state = { chainId: Number(network.chainId), block }

        if (COACH_ADDRESS) {
          const contract = coachContract(provider)
          // How many coaches exist right now. A number that moves as people
          // use the app is harder to fake than a screenshot.
          state.minted = Number(await contract.totalMinted())

          /*
           * Every id in one batch, control included, so a reader cannot be shown
           * the passes without the failure. `allSettled` because one reverting
           * call must not blank the four that answered — a partial answer here
           * is still evidence, and an empty card is not.
           */
          const answers = await Promise.allSettled(
            INTERFACES.map((row) => contract.supportsInterface(row.id)),
          )

          state.interfaces = INTERFACES.map((row, i) => ({
            ...row,
            answered: answers[i].status === 'fulfilled' ? answers[i].value : null,
          }))

          // The verifier the coach is wired to, read off the coach rather than
          // configured here: a claim about which contract guards transfers is
          // only worth anything if it comes from the contract doing the guarding.
          state.verifier = await contract.transferVerifier().catch(() => null)
        }

        if (!cancelled) setChain(state)
      } catch (e) {
        if (!cancelled) setError(e.shortMessage || e.message || t('Could not reach 0G.'))
      }
    })()

    return () => { cancelled = true }
  }, [])

  return (
    <div className="narrow">
      <div className="hdr">
        <button className="iconbtn" onClick={() => nav('/home')} aria-label={t('Home')}>
          <Icon name="chevronLeft" />
        </button>
        <div style={{ flex: 1, marginLeft: 12 }}>
          <h1>{t('Verify')}</h1>
          <div className="sub">{t('Every claim, and how to check it without us.')}</div>
        </div>
      </div>

      {/* Live, before anything else: this page proves itself as it loads. */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 8px' }}>{t('0G Galileo, read live just now')}</h3>
        {error ? (
          <div className="muted small">
            {t('Could not reach 0G right now:')} {error}
            <div style={{ height: 8 }} />
            <Link href={`${EXPLORER}/address/${COACH_ADDRESS}`}>{t('Check the contract on the explorer instead')}</Link>
          </div>
        ) : !chain ? (
          <div className="skel" style={{ height: 68 }} />
        ) : (
          <div className="tiles" style={{ textAlign: 'left' }}>
            <div className="tile">
              <div className="l">{t('Chain')}</div>
              <div className="v" style={{ fontSize: 20 }}>{chain.chainId}</div>
            </div>
            <div className="tile">
              <div className="l">{t('Block')}</div>
              <div className="v" style={{ fontSize: 20 }}>{chain.block?.toLocaleString?.() ?? chain.block}</div>
            </div>
            <div className="tile">
              <div className="l">{t('Coaches minted')}</div>
              <div className="v" style={{ fontSize: 20 }}>{chain.minted ?? '—'}</div>
            </div>
          </div>
        )}
        <div className="dim small" style={{ marginTop: 8 }}>
          {t('Read from the public 0G RPC by your browser, not by our server.')}
        </div>
      </div>

      <h4 className="sec">{t('The contract')}</h4>

      {/*
        * Asked, not asserted.
        *
        * This block used to be a sentence saying `supportsInterface(0x4b396f04)`
        * returns true, on a page whose entire purpose is not being taken at our
        * word. Now the browser asks the deployed bytecode while the page loads.
        *
        * The last row is the one that makes the rest mean anything: an id
        * nothing implements, which must come back false. A contract answering
        * true to everything would pass every other row here — so without a
        * control, five green ticks prove only that a function exists.
        */}
      <div className="card" style={{ marginBottom: 12 }}>
        <h3 style={{ margin: '0 0 4px' }}>{t('supportsInterface — asked just now')}</h3>
        <div className="dim small" style={{ marginBottom: 10 }}>
          {t('Read from the deployed contract by your browser, over the public 0G RPC.')}
        </div>

        {error ? (
          <div className="muted small">
            {t('Could not reach 0G right now.')}{' '}
            <Link href={`${EXPLORER}/address/${COACH_ADDRESS}`}>{t('Read it on the explorer instead')}</Link>
          </div>
        ) : !chain?.interfaces ? (
          <div className="skel" style={{ height: 130 }} />
        ) : (
          <div>
            {chain.interfaces.map((row) => (
              <InterfaceRow key={row.id} {...row} />
            ))}
            <div className="dim small" style={{ marginTop: 10, lineHeight: 1.45 }}>
              {t('The last one is a control: an interface id nothing implements. A contract that answered true to everything would pass every other line above, so a false there is what makes the rest worth reading.')}
            </div>
          </div>
        )}
      </div>

      <Claim
        title={t('CoachAgent is deployed and anyone can read it')}
        evidence={<Link href={`${EXPLORER}/address/${COACH_ADDRESS}`}>{COACH_ADDRESS}</Link>}
      >
        {t('A genuine ERC-7857 Agentic ID (and ERC-721): each token is one person’s coach — its encrypted brain’s hash and 0G Storage address, its version, its owner.')}
      </Claim>

      <Claim
        title={t('And the transfer it defines actually transfers')}
        evidence={
          chain?.verifier
            ? <Link href={`${EXPLORER}/address/${chain.verifier}`}>{chain.verifier}</Link>
            : <span className="muted">{t('transferVerifier() on the contract above')}</span>
        }
      >
        {t('ERC-7857 exists for one moment: an agent changes hands and its encrypted brain is re-encrypted to the buyer, so the seller’s key stops being useful. iTransferFrom calls the verifier above, which checks that the attestation covers this exact coach, this exact buyer and the exact sealed key — and spends it, so it cannot be used twice. The attestor is a software key held by the service that does the re-encryption, not a hardware enclave; that is weaker, and it is said here rather than left out.')}
      </Claim>

      <Claim
        title={t('Owning a coach needs no wallet, and no crypto')}
        evidence={<span className="muted">{t('EIP-712 signature from a key made in your browser; the app pays the gas.')}</span>}
      >
        {t('A key is generated on your device and never leaves it. It signs; our relayer pays the fee. The owning address can hold nothing at all and still own the coach — open Proof on a device that has one and the balance reads 0.')}
      </Claim>

      <Claim
        title={t('Payment and access are the same transaction')}
        evidence={<span className="muted">{t('rent() in CoachAgent.sol — the payout is the last statement in the function.')}</span>}
      >
        {t('Renting a trainer’s coach forwards the whole payment to them inside the same call that grants access. The contract has no withdraw function and never holds a balance — an invariant test asserts exactly that across random sequences of calls.')}
      </Claim>

      <Claim
        title={t('Selling a coach takes every rental with it')}
        evidence={<span className="muted">{t('An epoch counter invalidates all grants on transfer.')}</span>}
      >
        {t('Otherwise a trainer could rent access widely, sell the coach, and hand the buyer something a crowd still has keys to.')}
      </Claim>

      <h4 className="sec">{t('Check it yourself')}</h4>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="muted small">{t('The contract tests, including fuzz and invariant runs:')}</div>
        <Command>{`git clone ${REPO}
cd LIFTWITHOG/contracts && forge test`}</Command>

        <div className="muted small" style={{ marginTop: 14 }}>
          {t('The app’s own tests:')}
        </div>
        <Command>{`npm --prefix frontend test
npm --prefix api test`}</Command>

        <div className="muted small" style={{ marginTop: 14 }}>
          {t('And the one that matters most — it breaks the code on purpose and fails if the tests do not notice:')}
        </div>
        <Command>node scripts/mutate.mjs</Command>
      </div>

      <h4 className="sec">{t('What we are not claiming')}</h4>

      <div className="card">
        <div className="muted small" style={{ lineHeight: 1.5 }}>
          {t('0G Galileo is a test network, so rentals move test tokens rather than money.')}{' '}
          {t('A signature proves a device agreed to something; it cannot prove the person holding that device lifted what they typed.')}{' '}
          {t('Attested inference proves where a model ran and that nobody could read the input — not that its advice is good.')}{' '}
          {t('This project is built on the open-source openGym tracker; the training, nutrition and 0G work described here is ours.')}
        </div>
      </div>

      <div style={{ height: 14 }} />
      <Button icon="link" onClick={() => window.open(REPO, '_blank', 'noopener')}>
        {t('Read the source')}
      </Button>
      <div style={{ height: 24 }} />
    </div>
  )
}

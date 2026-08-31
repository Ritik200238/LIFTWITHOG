/**
 * Everything this app claims, and the thing that proves it.
 *
 * One screen, reachable from settings, that nobody has to open. It exists for
 * the person who reads "your coach is yours" and wants to know whether that is
 * a fact or a slogan — and every line here is either read live from the chain
 * or links somewhere they can check without taking our word for it.
 *
 * Deliberately the only place in this app that uses the words. Everywhere else
 * a coach is a coach; here it is a token id, an owner and a version count,
 * because that is what somebody came to this screen for.
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ethers } from 'ethers'
import { useCoach } from '../store/useCoach.js'
import { COACH_ADDRESS, coachContract } from '../lib/ogCoach.js'
import { readProvider } from '../lib/marketplace.js'
import { OG_NETWORK } from '../lib/ogVault.js'
import { deviceAddressIfAny, storedPhrase } from '../lib/deviceKey.js'
import { dateLocale, t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'

const EXPLORER = 'https://chainscan-galileo.0g.ai'

function Row({ label, children }) {
  return (
    <div className="row between" style={{ padding: '8px 0', gap: 12, alignItems: 'flex-start' }}>
      <div className="muted small" style={{ flexShrink: 0 }}>
        {label}
      </div>
      <div className="small" style={{ textAlign: 'right', wordBreak: 'break-all' }}>
        {children}
      </div>
    </div>
  )
}

export default function Proof() {
  const nav = useNavigate()
  const tokenId = useCoach((s) => s.tokenId)
  const [chain, setChain] = useState(null)
  const [device, setDevice] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const address = await deviceAddressIfAny()
        if (!cancelled) setDevice(address)

        const provider = readProvider()
        const network = await provider.getNetwork()
        const block = await provider.getBlockNumber()

        const state = {
          chainId: Number(network.chainId),
          block,
          contract: COACH_ADDRESS,
        }

        if (tokenId && COACH_ADDRESS) {
          const contract = coachContract(provider)
          const [, configURI, version, updatedAt] = await contract.coachOf(tokenId)
          state.owner = await contract.ownerOf(tokenId)
          state.version = Number(version)
          state.updatedAt = Number(updatedAt) * 1000
          state.configURI = configURI

          // The point of the whole relayed scheme, as a number somebody can see:
          // the address that owns this coach has never held anything.
          state.ownerBalance = ethers.formatEther(await provider.getBalance(state.owner))
        }

        if (!cancelled) setChain(state)
      } catch (e) {
        if (!cancelled) setError(e.shortMessage || e.message || 'Could not read the chain.')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [tokenId])

  return (
    <div className="narrow">
      {/*
        * A way back. This screen is reachable only from Settings and had no
        * chevron, so the only escape was the tab bar — which drops you out of
        * Settings entirely and loses where you were.
        */}
      <div className="hdr">
        <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}>
          <Icon name="chevronLeft" />
        </button>
        <div style={{ flex: 1, marginLeft: 4 }}>
          <h1>{t('Proof')}</h1>
          <div className="sub">{t('Read live from 0G. Check any of it yourself.')}</div>
        </div>
      </div>

      {error && (
        <div className="card" role="alert">
          <div className="muted small">{error}</div>
        </div>
      )}

      <div className="card">
        <h3 style={{ margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="sparkles" /> {t('Your coach')}
        </h3>

        {!tokenId && (
          <div className="muted small">
            {t('You have not created one yet. When you do, it will be owned by this device and recorded here.')}
          </div>
        )}

        {tokenId && chain && (
          <>
            <Row label={t('Token')}>
              <a href={`${EXPLORER}/address/${chain.contract}`} target="_blank" rel="noreferrer">
                #{tokenId}
              </a>
            </Row>
            <Row label={t('Version')}>{chain.version}</Row>
            <Row label={t('Owner')}>
              <a href={`${EXPLORER}/address/${chain.owner}`} target="_blank" rel="noreferrer">
                {chain.owner}
              </a>
            </Row>
            {/*
              * The line that makes the whole scheme legible. This address owns a
              * coach and has never held a coin — which is what "no wallet
              * needed" means, stated as a number rather than a promise.
              */}
            <Row label={t('That address holds')}>{chain.ownerBalance} 0G</Row>
            <Row label={t('Its brain, on 0G Storage')}>
              <span title={chain.configURI}>{String(chain.configURI).slice(0, 22)}…</span>
            </Row>
            <Row label={t('Last learned')}>
              {chain.updatedAt ? new Date(chain.updatedAt).toLocaleString(dateLocale()) : '—'}
            </Row>
          </>
        )}
      </div>

      <div className="card">
        <h3 style={{ margin: '0 0 4px' }}>{t('This device')}</h3>
        <div className="muted small" style={{ marginBottom: 8 }}>
          {t('A key made here, on this device, that has never been anywhere else. It signs; we pay the fee.')}
        </div>
        <Row label={t('Address')}>{device ?? t('none yet')}</Row>
        <Row label={t('Recovery phrase')}>
          {storedPhrase() ? t('held on this device only') : t('not created yet')}
        </Row>
      </div>

      <div className="card">
        <h3 style={{ margin: '0 0 4px' }}>{t('The network')}</h3>
        {chain ? (
          <>
            <Row label={t('Chain')}>
              {chain.chainId === OG_NETWORK.chainId
                ? `${OG_NETWORK.name} (${OG_NETWORK.chainId})`
                : chain.chainId}
            </Row>
            <Row label={t('Block')}>{chain.block}</Row>
            <Row label={t('Contract')}>
              <a href={`${EXPLORER}/address/${chain.contract}`} target="_blank" rel="noreferrer">
                {chain.contract}
              </a>
            </Row>
          </>
        ) : (
          <div className="muted small">{t('Reading…')}</div>
        )}
      </div>

      <div className="card">
        <h3 style={{ margin: '0 0 4px' }}>{t('What is not proven')}</h3>
        {/*
          * On this screen more than anywhere else. A page of green ticks that
          * quietly omits its own limits is marketing with better typography.
          */}
        <div className="muted small">
          Nothing here proves you lifted anything. An enclave proves a computation ran untampered;
          it cannot see a barbell, and the workout log it would attest is typed by the person
          being attested. What is provable is that a coach&rsquo;s history cannot be invented
          after the fact.
          <br />
          <br />
          0G Galileo is a testnet. Rentals move test tokens — the mechanism is real, the money is
          not, until mainnet.
        </div>
      </div>

      <div style={{ height: 24 }} />
    </div>
  )
}

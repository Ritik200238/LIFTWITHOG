/**
 * Coaches to rent.
 *
 * A trainer's method is their income, and today it is sold as a PDF that is
 * screenshotted within a week. Here it stays encrypted, runs inside an enclave
 * the renter does not control, and access ends by itself when the month does.
 *
 * The listing is deliberately made of facts the chain wrote rather than a
 * description somebody typed. Age and version count cannot be edited after the
 * event, which gives this the one guarantee a marketplace of strangers needs:
 * you cannot fake time. A coach with a year behind it has a year behind it.
 */

import { useCallback, useEffect, useState } from 'react'
import { ethers } from 'ethers'
import { useCoach } from '../store/useCoach.js'
import { useUI } from '../store/useUI.js'
import {
  costFor,
  creationTimes,
  formatPrice,
  historyLine,
  listRentableCoaches,
  readProvider,
} from '../lib/marketplace.js'
import { COACH_ADDRESS, coachContract } from '../lib/ogCoach.js'
import { deviceSigner } from '../lib/deviceKey.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { t } from '../lib/i18n.js'
import { confirmSheet } from '../sheets.jsx'

const RENTAL_DAYS = 30

export default function Market() {
  const [coaches, setCoaches] = useState(null)
  const [error, setError] = useState(null)
  const [renting, setRenting] = useState(null)
  const [asking, setAsking] = useState(null)
  const [access, setAccess] = useState({})
  const myTokenId = useCoach((s) => s.tokenId)
  const toast = useUI((s) => s.toast)

  const load = useCallback(async () => {
    setError(null)
    try {
      const listed = await listRentableCoaches()
      const created = await creationTimes(listed.map((c) => c.tokenId))

      setCoaches(listed.map((c) => ({ ...c, createdAt: created[c.tokenId] ?? null })))

      // Which of these this device can already use. Read per coach so a coach
      // whose rental lapsed stops showing as rented the moment it does.
      const { address } = await deviceSigner()
      const contract = coachContract(readProvider())
      const state = {}
      /*
       * All at once. These were awaited one after another, so a marketplace of
       * ten coaches meant ten sequential round-trips to a testnet RPC before
       * anything appeared — and the screen said "Reading the chain…" for all
       * of them. They are independent questions; nothing was gained by asking
       * them in order.
       */
      const results = await Promise.all(
        listed.map(async (c) => {
          try {
            return [c.tokenId, await contract.hasAccess(c.tokenId, address)]
          } catch {
            // Fails closed: an unreadable answer is not access.
            return [c.tokenId, false]
          }
        }),
      )
      for (const [tokenId, allowed] of results) state[tokenId] = allowed
      setAccess(state)
    } catch (e) {
      setError(e.message || 'Could not read the marketplace.')
      setCoaches([])
    }
  }, [])

  /**
   * Ask a coach somebody is renting.
   *
   * The same call the home coach uses, with the rented token id — the server
   * checks `hasAccess` on chain for the asking address, so a lapsed rental
   * stops working on its own without anything here having to know.
   */
  const ask = async (coach) => {
    setAsking(coach.tokenId)
    try {
      const { askCoach, deviceSignerForAsk } = await import('../lib/coachAsk.js')
      const signer = await deviceSignerForAsk()
      const answer = await askCoach(
        signer,
        coach.tokenId,
        'Based on my training history, what should I work on next?',
      )
      confirmSheet({ title: t('Your coach says'), message: answer, confirmText: t('Got it'), onConfirm: () => {} })
    } catch (e) {
      toast(e.message || t('That coach could not answer.'))
    } finally {
      setAsking(null)
    }
  }

  const storedListing = useCoach((s) => s.listedFor)

  /**
   * What the chain says this coach is listed at, preferred over what we
   * remember listing it at.
   *
   * The stored value is a convenience, not a source of truth: it is written
   * when this device lists and survives in local storage, so a cleared cache —
   * or a coach whose price was set from somewhere else — would show "List my
   * coach" for a coach that is already listed, and the trainer would pay a
   * second fee to change nothing. The market list already carries the real
   * price, so use it whenever it has loaded.
   */
  const listedFor =
    coaches === null
      // Still reading the chain: show what we last knew rather than flickering
      // "not listed" at somebody whose coach is on the market.
      ? storedListing
      // The chain has answered. A coach absent from the rentable list is not
      // rentable — including one delisted from another device, which the
      // stored value would otherwise keep claiming is live.
      : String(coaches.find((c) => c.tokenId === myTokenId)?.pricePerDay ?? '0')
  const setPrice = useCoach((s) => s.setPrice)

  const [priceInput, setPriceInput] = useState('')
  const [listing, setListing] = useState(false)
  const [listError, setListError] = useState(null)

  /**
   * List, or change the price.
   *
   * Parsed as 0G rather than wei: a trainer thinks in the token, and asking
   * anybody to type 200000000000000 is how a marketplace stays empty.
   */
  const list = async () => {
    setListError(null)
    let wei
    try {
      wei = ethers.parseEther(priceInput.trim())
    } catch {
      setListError(t('That is not a price. Try something like 0.0002.'))
      return
    }
    if (wei <= 0n) {
      setListError(t('A price has to be more than nothing — use “take it off the market” instead.'))
      return
    }

    setListing(true)
    try {
      await setPrice(wei.toString())
      toast(t('Your coach is on the market.'))
      await load()
    } catch (e) {
      setListError(e.shortMessage || e.message || t('That could not be listed.'))
    } finally {
      setListing(false)
    }
  }

  const delist = () =>
    confirmSheet({
      title: t('Take it off the market?'),
      message: t('Nobody new can rent it. Rentals already paid for run to their end — taking a listing down does not take back access somebody bought.'),
      confirmText: t('Take it off'),
      onConfirm: async () => {
        setListing(true)
        try {
          await setPrice('0')
          setPriceInput('')
          toast(t('It is off the market.'))
          await load()
        } catch (e) {
          setListError(e.shortMessage || e.message || t('That could not be changed.'))
        } finally {
          setListing(false)
        }
      },
    })

  useEffect(() => {
    void load()
  }, [load])

  /**
   * Rent, which is the one moment a wallet is the right thing to ask for.
   *
   * Everything else in this app works without one because it costs nothing.
   * This spends money, and money should be spent from something the person
   * controls — not from a key an app generated quietly on their behalf.
   */
  const rent = async (coach) => {
    if (!window.ethereum) {
      /*
       * "Spends real funds" contradicted the line at the bottom of this very
       * screen, which says this is a test network moving test tokens. Two
       * sentences a thumb-length apart, disagreeing about whether the money is
       * real — and the honest one is the footer.
       *
       * What is true either way is that renting is the one thing here that
       * moves value from an account, so it needs a wallet, and nothing else in
       * the app does.
       */
      toast(t('Renting is the one thing here that needs a wallet. Everything else works without one.'))
      return
    }

    setRenting(coach.tokenId)
    try {
      const browser = new ethers.BrowserProvider(window.ethereum)
      const signer = await browser.getSigner()
      const contract = coachContract(signer)

      const value = costFor(coach.pricePerDay, RENTAL_DAYS)
      const tx = await contract.rent(coach.tokenId, RENTAL_DAYS, { value })
      await tx.wait()

      toast(t('Rented. The trainer was paid in the same transaction.'))
      await load()
    } catch (e) {
      toast(e.shortMessage || e.message || t('That rental did not go through.'))
    } finally {
      setRenting(null)
    }
  }

  if (!COACH_ADDRESS) {
    return (
      <div className="narrow">
        <div className="hdr">
          <div>
            <h1>{t('Coaches')}</h1>
            <div className="sub">{t('This build has no coach marketplace set up.')}</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="narrow">
      <div className="hdr">
        <div>
          <h1>{t('Coaches')}</h1>
          <div className="sub">{t('Rent a trainer’s method. It stays theirs.')}</div>
        </div>
      </div>

      {/*
        * The trainer half of the marketplace, and the reason it can exist at
        * all: listing used to be a script somebody at this company ran,
        * because `setRentalPrice` is owner-only and a phone-minted coach owns
        * itself with a key holding no gas. Relayed, any trainer lists from the
        * device that already holds their coach.
        */}
      {myTokenId && (
        <div className="card" style={{ marginBottom: 12 }}>
          <h3 style={{ margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="sparkles" /> {t('Your coach, on the market')}
          </h3>
          <div className="muted small" style={{ marginBottom: 10 }}>
            {listedFor && listedFor !== '0'
              ? t('Listed at {0} 0G a day. Renters pay you directly — the payment never touches us.', formatPrice(listedFor))
              : t('Coach #{0} is yours. Name a day rate and other people can train with your method — they pay you, in the same transaction that grants them access.', myTokenId)}
          </div>

          <label className="row between" style={{ gap: 12, alignItems: 'center' }}>
            <span className="muted small">{t('Price per day (0G)')}</span>
            <input
              className="inp"
              inputMode="decimal"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              placeholder="0.0002"
              style={{ maxWidth: 140, textAlign: 'right' }}
              aria-label={t('Price per day in 0G')}
            />
          </label>

          <div style={{ height: 10 }} />
          <Button
            variant="primary"
            icon="sparkles"
            disabled={listing || !priceInput.trim()}
            onClick={list}
          >
            {listing
              ? t('Listing…')
              : listedFor && listedFor !== '0'
                ? t('Update my price')
                : t('List my coach')}
          </Button>

          {listedFor && listedFor !== '0' && (
            <>
              <div style={{ height: 8 }} />
              <Button className="dim" disabled={listing} onClick={delist}>
                {t('Take it off the market')}
              </Button>
            </>
          )}

          {listError && (
            <div className="muted small" role="alert" style={{ marginTop: 8 }}>
              {listError}
            </div>
          )}

          <div className="dim small" style={{ marginTop: 8, lineHeight: 1.4 }}>
            {t('No wallet and no gas needed — your device signs, we pay the fee. Renting is what pays you.')}
          </div>
        </div>
      )}

      {/*
        * A skeleton, not "Reading the chain…". What somebody is waiting for is
        * a list of coaches; how it is fetched is our business, and naming the
        * mechanism does not make the wait shorter.
        */}
      {coaches === null && (
        <div className="card">
          <div className="muted small">{t('Looking for coaches…')}</div>
          <div style={{ height: 10 }} />
          <div className="skel" style={{ width: '60%' }} />
          <div style={{ height: 8 }} />
          <div className="skel" style={{ width: '35%' }} />
        </div>
      )}

      {error && (
        <div className="card" role="alert">
          <div className="muted small">{error}</div>
        </div>
      )}

      {coaches?.length === 0 && !error && (
        <div className="card">
          <div className="muted small">
            {t('No coach is listed for rent yet. Yours can be — set a price and it appears here.')}
          </div>
        </div>
      )}

      {coaches?.map((coach) => {
        const mine = coach.tokenId === myTokenId
        const rented = access[coach.tokenId]

        return (
          <div className="card" key={coach.tokenId} style={{ marginTop: 12 }}>
            <div className="row between" style={{ marginBottom: 6 }}>
              <div>
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="sparkles" /> Coach #{coach.tokenId}
                </h3>
                {/*
                  * The trust story, and every word of it written by the contract:
                  * how old it is, and how many times it has learned. Neither can
                  * be edited after the fact, which is why this is here instead of
                  * a description somebody typed.
                  */}
                <div className="muted small">{historyLine(coach)}</div>
              </div>
              {/* `formatPrice` returns null for a price of zero, which rendered
                  an empty green pill. Free is a thing a coach can be, and it
                  should say so. */}
              <span className="tag acc">{formatPrice(coach.pricePerDay) ?? t('Free')}</span>
            </div>

            {mine && <div className="muted small">{t('This one is yours.')}</div>}

            {/*
              * A button, not a sentence.
              *
              * This said "You can use this coach. Ask it anything." and gave
              * nobody anywhere to do it: the only ask flow in the app passed
              * your *own* coach id, so a rented coach was a paid dead end. The
              * server already accepts any token id and checks `hasAccess` on
              * chain, so the rental was enforceable all along — nothing here
              * ever offered it.
              */}
            {!mine && rented && (
              <Button
                icon="sparkles"
                disabled={asking === coach.tokenId}
                onClick={() => ask(coach)}
              >
                {asking === coach.tokenId ? t('Asking…') : t('Ask this coach')}
              </Button>
            )}

            {!mine && !rented && (
              <Button
                variant="primary"
                icon="sparkles"
                disabled={renting === coach.tokenId}
                onClick={() => rent(coach)}
              >
                {renting === coach.tokenId
                  ? t('Renting…')
                  : t('Rent for {0} days · {1} 0G', RENTAL_DAYS, ethers.formatEther(
                      costFor(coach.pricePerDay, RENTAL_DAYS),
                    ))}
              </Button>
            )}
          </div>
        )
      })}

      <div style={{ height: 14 }} />
      <div className="muted small">
        {t('Payment and access arrive together, and none of it is held by us — it goes straight to the trainer. Access ends by itself when the month does.')}
        <br /><br />
        {/* The same honesty the proof screen carries, where somebody is about
            to spend something. It was only stated on a screen nobody has to
            open. */}
        {t('0G Galileo is a test network: this moves test tokens, not real money.')}
      </div>
      <div style={{ height: 24 }} />
    </div>
  )
}

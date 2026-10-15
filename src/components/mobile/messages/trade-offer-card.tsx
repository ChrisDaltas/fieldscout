'use client'

import { cn } from '@/lib/utils'

import { MessagesAvatar } from './messages-avatar'
import { directionWords, initialOf, type MTradeOffer, type MTradeTone } from './messages-ops'

const STATUS_PILL: Record<MTradeTone, string> = {
  pending: 'bg-m-go text-m-to',
  accepted: 'bg-m-gg text-m-tg',
  declined: 'bg-m-gr text-m-tr',
  neutral: 'bg-m-b2 text-m-t3',
}

/** One answer button on the card: what it does, and whether it can now. */
export interface OfferAnswer {
  onClick: () => void
  disabled: boolean
}

/**
 * The answers an incoming pending offer carries (S2a). A button is null when
 * the league wouldn't take that answer from this manager now (`tradeActions`,
 * the Accept gate); `note` says why Accept is missing or can't be trusted.
 */
export interface OfferAnswers {
  decline: OfferAnswer | null
  counter: OfferAnswer | null
  accept: OfferAnswer | null
  note: string | null
}

/**
 * A trade offer on the Messages › Trades tab (§2.1 F): 16px-radius card
 * with a 1px b3 ring; head row (36px avatar, name, "Sent to you · 8m",
 * status pill); "You get" / "You give" boxes; and — for an offer waiting on
 * my answer — Decline / Counter / Accept. Pressed b1.
 *
 * The whole card opens the offer (S4); the answers sit above that target
 * (no button inside a button).
 */
export function TradeOfferCard({
  offer,
  onOpen,
  answers = null,
}: {
  offer: MTradeOffer
  onOpen: () => void
  answers?: OfferAnswers | null
}) {
  const buttons = answers ? [answers.decline, answers.counter, answers.accept].filter(Boolean).length : 0
  return (
    <div
      className="relative flex flex-col gap-2.5 rounded-[16px] p-3 text-m-t1 shadow-m-outline"
      data-trade-offer={offer.id}
      data-trade-offer-league={offer.leagueId}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open trade offer ${offer.dir === 'in' ? 'from' : 'to'} ${offer.name}`}
        className="absolute inset-0 rounded-[16px] active:bg-m-b1"
      />
      <div className="pointer-events-none relative flex items-center gap-2.5">
        <MessagesAvatar
          text={initialOf(offer.name)}
          src={offer.avatarUrl}
          sizeClass="size-9"
          colorClass={offer.colorClass}
          textClass="text-[13px]"
        />
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="truncate text-[14px] font-semibold">{offer.name}</span>
          <span className="truncate text-[11px] font-medium text-m-t3">
            {directionWords(offer.dir)} · {offer.time}
          </span>
        </span>
        <span
          className={cn(
            'flex h-[22px] flex-none items-center rounded-pill px-[9px] text-[11px] font-semibold',
            STATUS_PILL[offer.status.tone],
          )}
          data-trade-offer-status={offer.status.tone}
        >
          {offer.status.label}
        </span>
      </div>
      <div className="pointer-events-none relative grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
        <AssetBox label="You get" labelClass="text-positive-strong" assets={offer.gets} />
        <AssetBox label="You give" labelClass="text-negative-strong" assets={offer.gives} />
      </div>
      {buttons > 0 && answers && (
        <div
          className={cn(
            'pointer-events-none relative grid gap-1.5',
            buttons === 3 ? 'grid-cols-3' : buttons === 2 ? 'grid-cols-2' : 'grid-cols-1',
          )}
          data-trade-offer-actions
        >
          {answers.decline && (
            <button
              type="button"
              onClick={answers.decline.onClick}
              disabled={answers.decline.disabled}
              className="pointer-events-auto flex h-[34px] items-center justify-center rounded-pill bg-m-gr text-[13px] font-semibold text-m-tr disabled:opacity-50"
            >
              Decline
            </button>
          )}
          {answers.counter && (
            <button
              type="button"
              onClick={answers.counter.onClick}
              disabled={answers.counter.disabled}
              className="pointer-events-auto flex h-[34px] items-center justify-center rounded-pill bg-m-b2 text-[13px] font-semibold text-m-t1 disabled:opacity-50"
            >
              Counter
            </button>
          )}
          {answers.accept && (
            <button
              type="button"
              onClick={answers.accept.onClick}
              disabled={answers.accept.disabled}
              className="pointer-events-auto flex h-[34px] items-center justify-center rounded-pill bg-confirm text-[13px] font-semibold text-white disabled:bg-m-b3s disabled:text-m-t3"
            >
              Accept
            </button>
          )}
        </div>
      )}
      {answers?.note && (
        <p className="pointer-events-none relative text-[11px] font-medium leading-[1.35] text-m-t3" data-trade-offer-note>
          {answers.note}
        </p>
      )}
    </div>
  )
}

function AssetBox({ label, labelClass, assets }: { label: string; labelClass: string; assets: readonly string[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[10px] bg-m-b1 px-2.5 py-2">
      <span className={cn('text-[10px] font-semibold', labelClass)}>{label}</span>
      {assets.map((a, i) => (
        <span key={`${a}-${i}`} className="truncate text-[13px] font-semibold">
          {a}
        </span>
      ))}
      {assets.length === 0 && <span className="text-[13px] font-medium text-m-t3">Nothing</span>}
    </div>
  )
}

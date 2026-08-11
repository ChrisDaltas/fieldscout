'use client'

// Internal style guide — the reskin acceptance checklist (package screenshot
// 16). Every primitive and token renders here; if a section looks wrong the
// system is wrong. Not linked from nav; visit /app/styleguide.
import { useState } from 'react'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge, FilterChip } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Icon, ICON_NAMES } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Segment,
  SegmentItem,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import { POSITION_TAB_ACTIVE } from '@/components/players/position-badge'

const SWATCHES: Array<{ name: string; className: string; ink?: boolean }> = [
  { name: 'Page', className: 'bg-page', ink: true },
  { name: 'Ink', className: 'bg-ink' },
  { name: 'Muted n-3', className: 'bg-n-3' },
  { name: 'Hairline n-4', className: 'bg-n-4', ink: true },
  { name: 'Brand lime', className: 'bg-brand', ink: true },
  { name: 'Brand strong', className: 'bg-brand-strong' },
  { name: 'Brand soft', className: 'bg-brand-soft', ink: true },
  { name: 'Accent', className: 'bg-accent' },
  { name: 'Accent strong', className: 'bg-accent-strong' },
  { name: 'Accent soft', className: 'bg-accent-soft', ink: true },
  { name: 'Positive', className: 'bg-positive', ink: true },
  { name: 'Negative', className: 'bg-negative', ink: true },
  { name: 'Caution', className: 'bg-caution', ink: true },
]

// Static class maps — Tailwind can't see dynamically-built class names.
const POS_BG: Record<string, string> = {
  qb: 'bg-pos-qb',
  rb: 'bg-pos-rb',
  wr: 'bg-pos-wr',
  te: 'bg-pos-te',
  flex: 'bg-pos-flex',
  k: 'bg-pos-k',
  def: 'bg-pos-def',
}
const TIER_BG: Record<number, string> = {
  1: 'bg-tier-1',
  2: 'bg-tier-2',
  3: 'bg-tier-3',
  4: 'bg-tier-4',
  5: 'bg-tier-5',
  6: 'bg-tier-6',
  7: 'bg-tier-7',
}
const POSITIONS = Object.keys(POS_BG)
const TIERS = [1, 2, 3, 4, 5, 6, 7]

export default function StyleGuidePage() {
  const [chipOn, setChipOn] = useState(true)
  const [segMode, setSegMode] = useState<'rail' | 'gallery' | 'compare'>('rail')
  const [segTab, setSegTab] = useState<'mine' | 'saved'>('mine')

  return (
    <div className="mx-auto flex max-w-content flex-col gap-6 p-6">
      {/* Hero */}
      <div className="rounded-sm border border-ink bg-ink p-6 text-white">
        <p className="font-wordmark text-h4 text-brand">FIELDSCOUT</p>
        <p className="mt-2 max-w-xl text-[14px] text-white/80">
          Neo-brutalist system: grey pages, white cards, 1px ink borders, hard
          shadows, heavy headings, lime brand + ultramarine accent. This page
          is the reskin acceptance checklist.
        </p>
      </div>

      {/* Typography */}
      <Card>
        <CardHeader>
          <CardTitle>Typography</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 p-card-pad">
          <p className="text-h1">Heading one</p>
          <p className="text-h2">Heading two</p>
          <p className="text-h3">Heading three</p>
          <p className="text-h4">Heading four</p>
          <p className="text-h5">Heading five</p>
          <p className="text-h6">Heading six</p>
          <p className="text-[14px]">
            Body 14 — weight 500. Lead with the call, back it with one stat.
          </p>
          <p className="text-[13px] text-n-3">Muted 13 — secondary line.</p>
          <p className="fs-num text-[14px]">
            Mono numerals: 22.1 · 28% · #31 vs RB · $57
          </p>
        </CardContent>
      </Card>

      {/* Color */}
      <Card>
        <CardHeader>
          <CardTitle>Color</CardTitle>
        </CardHeader>
        <CardContent className="p-card-pad">
          <div className="flex flex-wrap gap-2">
            {SWATCHES.map((s) => (
              <div
                key={s.name}
                className={`flex h-16 w-28 items-end rounded-sm border border-ink p-1.5 text-[11px] font-bold ${s.className} ${s.ink ? 'text-ink' : 'text-white'}`}
              >
                {s.name}
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {POSITIONS.map((p) => (
              <span
                key={p}
                className={`inline-flex h-chip items-center rounded-sm border border-ink ${POS_BG[p]} px-2 text-[11px] font-bold text-white`}
              >
                {p.toUpperCase()}
              </span>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {TIERS.map((t) => (
              <span
                key={t}
                className={`inline-flex h-chip items-center rounded-sm border border-ink ${TIER_BG[t]} px-2 text-[11px] font-bold ${t === 3 || t === 4 ? 'text-ink' : 'text-white'}`}
              >
                Tier {t}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Buttons */}
      <Card>
        <CardHeader>
          <CardTitle>Buttons</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-card-pad">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="blue">Blue primary</Button>
            <Button variant="blue" shadow>
              Blue + shadow
            </Button>
            <Button variant="stroke">Stroke</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="dark" shadow>
              Dark + accent shadow
            </Button>
            <Button variant="green">Green</Button>
            <Button variant="lime" shadow>
              Lime + shadow
            </Button>
            <Button variant="destructive">Destructive</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="blue" size="md">
              Medium 29
            </Button>
            <Button variant="stroke" size="sm">
              Small 26
            </Button>
            <Button variant="stroke" size="icon" aria-label="Settings">
              <Icon name="setup" />
            </Button>
            <Button variant="blue" disabled>
              Disabled
            </Button>
            <Button variant="stroke">
              <Icon name="plus" />
              Icon left
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Forms */}
      <Card>
        <CardHeader>
          <CardTitle>Forms</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 p-card-pad sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-[12px] font-bold" htmlFor="sg-input">
              Display name
            </label>
            <Input id="sg-input" placeholder="Scout name…" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[12px] font-bold">Scoring</label>
            <Select defaultValue="ppr">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ppr">Full PPR</SelectItem>
                <SelectItem value="half">Half PPR</SelectItem>
                <SelectItem value="std">Standard</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-[13px] font-medium">
              <Checkbox defaultChecked /> Accent checkbox
            </label>
            <label className="flex items-center gap-2 text-[13px] font-medium">
              <Switch defaultChecked /> Lime switch
            </label>
          </div>
          <RadioGroup defaultValue="a" className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-[13px] font-medium">
              <RadioGroupItem value="a" /> Option A
            </label>
            <label className="flex items-center gap-2 text-[13px] font-medium">
              <RadioGroupItem value="b" /> Option B
            </label>
          </RadioGroup>
          <div className="space-y-3">
            <Progress value={62} />
            <Slider defaultValue={[40]} max={100} step={1} />
          </div>
        </CardContent>
      </Card>

      {/* Chips, badges, tabs */}
      <Card>
        <CardHeader>
          <CardTitle>Chips &amp; tabs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-card-pad">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="stroke">Stroke</Badge>
            <Badge variant="accent">Accent</Badge>
            <Badge variant="green">Start</Badge>
            <Badge variant="yellow">Questionable</Badge>
            <Badge variant="pink">Sit</Badge>
            <Badge variant="black">3 drafted</Badge>
            <Badge variant="lime">● Live</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FilterChip pressed={chipOn} onPressedChange={setChipOn}>
              Sleeper
            </FilterChip>
            <FilterChip pressed={!chipOn} onPressedChange={() => setChipOn(!chipOn)}>
              Breakout
            </FilterChip>
          </div>
          <p className="text-[12px] font-medium text-n-3">
            <span className="font-bold text-ink">FilterChip</span> — multi-select
            rows, and single-select rows where <em>nothing</em> selected is a real
            state. Everything one-of-many moved to the segment below (LV.11,
            Chris 2026-08-11: “use the tab component for now, we can create one
            for filters later”), so this is a temporary split, not a final one.
          </p>
          <p className="text-[12px] font-medium text-n-3">
            One control for every tab and segment (Chris, 2026-08-11). Three
            variations — icon + label, label only, icon only — each taking an
            optional count. Active is an accent fill with white text; inactive
            is full-contrast ink, never grey; hover is an accent-soft wash.
          </p>

          <div className="space-y-2">
            <p className="fs-overline text-n-3">
              Segment, boxed — icon + label, label only, icon only
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Segment aria-label="Page mode">
                <SegmentItem
                  icon="list"
                  active={segMode === 'rail'}
                  onClick={() => setSegMode('rail')}
                >
                  List
                </SegmentItem>
                <SegmentItem
                  icon="layers"
                  active={segMode === 'gallery'}
                  onClick={() => setSegMode('gallery')}
                >
                  Cards
                </SegmentItem>
                <SegmentItem
                  icon="table"
                  active={segMode === 'compare'}
                  onClick={() => setSegMode('compare')}
                >
                  Side by side
                </SegmentItem>
              </Segment>

              <Segment aria-label="Stat view">
                <SegmentItem active={segMode === 'rail'} onClick={() => setSegMode('rail')}>
                  Fantasy
                </SegmentItem>
                <SegmentItem active={segMode !== 'rail'} onClick={() => setSegMode('gallery')}>
                  NFL
                </SegmentItem>
              </Segment>

              <Segment aria-label="View style">
                <SegmentItem
                  icon="list"
                  aria-label="List view"
                  active={segMode === 'rail'}
                  onClick={() => setSegMode('rail')}
                />
                <SegmentItem
                  icon="table"
                  aria-label="Table view"
                  active={segMode === 'compare'}
                  onClick={() => setSegMode('compare')}
                />
                <SegmentItem
                  icon="layers"
                  aria-label="Cards view"
                  active={segMode === 'gallery'}
                  onClick={() => setSegMode('gallery')}
                />
              </Segment>
            </div>
          </div>

          <div className="space-y-2">
            <p className="fs-overline text-n-3">Segment, bare — label only × count</p>
            <Segment appearance="bare" aria-label="Which lists">
              <SegmentItem
                count={7}
                active={segTab === 'mine'}
                onClick={() => setSegTab('mine')}
              >
                My lists
              </SegmentItem>
              <SegmentItem
                count={2}
                active={segTab === 'saved'}
                onClick={() => setSegTab('saved')}
              >
                Saved
              </SegmentItem>
            </Segment>
          </div>

          <div className="space-y-2">
            <p className="fs-overline text-n-3">
              Tabs (Radix) — same look, real tabpanels and arrow-key navigation
            </p>
            <Tabs defaultValue="list">
              <TabsList>
                <TabsTrigger value="list">List</TabsTrigger>
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="comments" count={3}>
                  Comments
                </TabsTrigger>
              </TabsList>
              <TabsContent value="list" className="pt-3 text-[13px] text-n-3">
                Bare chips — the default for a Radix tab set, because a tab row
                sits above its own panel rather than framing itself.
              </TabsContent>
              <TabsContent value="details" className="pt-3 text-[13px] text-n-3">
                Arrow keys move between triggers; each one owns this panel.
              </TabsContent>
              <TabsContent value="comments" className="pt-3 text-[13px] text-n-3">
                The count is a mono numeral at 70% of the item’s own colour, so
                it de-emphasises on white and on the accent fill alike.
              </TabsContent>
            </Tabs>
          </div>

          <div className="space-y-2">
            <p className="fs-overline text-n-3">
              Tabs (Radix), boxed — a picker that filters in place
            </p>
            <Tabs defaultValue="all">
              <TabsList appearance="boxed">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="qb" className={POSITION_TAB_ACTIVE.QB}>
                  QB
                </TabsTrigger>
                <TabsTrigger value="rb" className={POSITION_TAB_ACTIVE.RB}>
                  RB
                </TabsTrigger>
                <TabsTrigger value="wr" className={POSITION_TAB_ACTIVE.WR}>
                  WR
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardContent>
      </Card>

      {/* Menus & modals */}
      <Card>
        <CardHeader>
          <CardTitle>Menus &amp; modals</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 p-card-pad">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="stroke">
                Menu
                <Icon name="arrow-bottom" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>Rename</DropdownMenuItem>
              <DropdownMenuItem>Add to folder</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-negative">
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="blue" shadow>
                Open modal
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Hard-shadow modal</DialogTitle>
                <DialogDescription>
                  Ink overlay at 85%, no blur. White panel, 1px border,
                  hard-8 shadow.
                </DialogDescription>
              </DialogHeader>
              <div className="flex justify-end gap-2">
                <Button variant="stroke">Cancel</Button>
                <Button variant="blue">Confirm</Button>
              </div>
            </DialogContent>
          </Dialog>
          <div className="flex items-center gap-2">
            {/* People are round; team/league crests are square. */}
            <Avatar className="rounded-pill border-0">
              <AvatarFallback className="rounded-pill">HR</AvatarFallback>
            </Avatar>
            <Avatar>
              <AvatarFallback>WW</AvatarFallback>
            </Avatar>
            <Skeleton className="h-9 w-32" />
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>Table</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Player</TableHead>
                <TableHead>Pos</TableHead>
                <TableHead className="text-right">Proj</TableHead>
                <TableHead className="text-right">ADP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                ['1', 'Bijan Robinson', 'rb', '324.9', '2.1'],
                ['2', 'Josh Allen', 'qb', '361.5', '18.4'],
                ['3', "Ja'Marr Chase", 'wr', '289.0', '3.7'],
              ].map(([rank, name, pos, proj, adp]) => (
                <TableRow key={rank}>
                  <TableCell className="fs-num">{rank}</TableCell>
                  <TableCell className="font-bold">{name}</TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex h-chip items-center rounded-sm border border-ink ${POS_BG[pos]} px-1.5 text-[11px] font-bold text-white`}
                    >
                      {String(pos).toUpperCase()}
                    </span>
                  </TableCell>
                  <TableCell className="fs-num text-right">{proj}</TableCell>
                  <TableCell className="fs-num text-right">{adp}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Icons */}
      <Card>
        <CardHeader>
          <CardTitle>Icons — filled 16×16 set</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3 p-card-pad">
          {ICON_NAMES.map((n) => (
            <span
              key={n}
              title={n}
              className="flex h-9 w-9 items-center justify-center rounded-sm border border-n-4"
            >
              <Icon name={n} />
            </span>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

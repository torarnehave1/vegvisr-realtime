import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Calendar, ChevronLeft, ChevronRight, Clock, X } from 'lucide-react';

/**
 * Dark-themed date + time picker that speaks the same string format as
 * <input type="datetime-local">: "YYYY-MM-DDTHH:mm" in local time, '' when unset.
 * Drop-in replacement for that input — no extra dependencies, no timezone surprises.
 */
interface DateTimePickerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minuteStep?: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Parse "YYYY-MM-DDTHH:mm" as local wall-clock time (never UTC). */
function parseLocal(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0);
  return isNaN(d.getTime()) ? null : d;
}

function formatLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** 6 fixed weeks (42 cells) starting on the Monday on/before the 1st — stable panel height. */
function monthGrid(view: Date): Date[] {
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7; // Monday = 0
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

/** Next full hour from now — the sane default when a day is picked before a time. */
function nextFullHour(): { h: number; m: number } {
  const now = new Date();
  return { h: (now.getHours() + 1) % 24, m: 0 };
}

const QUICK_TIMES = ['08:00', '09:00', '10:00', '12:00', '15:00', '18:00', '19:00', '20:00'];

export const DateTimePicker: React.FC<DateTimePickerProps> = ({
  value,
  onChange,
  placeholder = 'No time set',
  minuteStep = 5,
}) => {
  const selected = useMemo(() => parseLocal(value), [value]);
  const isPast = !!selected && selected.getTime() < Date.now();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<Date>(() => selected ?? new Date());
  const [cursor, setCursor] = useState<Date>(() => selected ?? new Date());
  const [keyNav, setKeyNav] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLButtonElement>(null);

  const locale = typeof navigator !== 'undefined' ? navigator.language || 'en-GB' : 'en-GB';
  const timeZone = useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; }
  }, []);

  const monthLabel = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(view),
    [locale, view]
  );

  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    // 2024-01-01 was a Monday.
    return Array.from({ length: 7 }, (_, i) => {
      const label = fmt.format(new Date(2024, 0, 1 + i)).replace(/\.$/, '');
      return label.charAt(0).toUpperCase() + label.slice(1, 2);
    });
  }, [locale]);

  const triggerLabel = useMemo(() => {
    if (!selected) return placeholder;
    return new Intl.DateTimeFormat(locale, {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(selected);
  }, [selected, locale, placeholder]);

  // Reopen on the selected month, not wherever the user last browsed.
  useEffect(() => {
    if (open) {
      const base = selected ?? new Date();
      setView(base);
      setCursor(base);
      setKeyNav(true); // land focus on the selected day so arrow keys work at once
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * The panel is portaled to <body> and positioned with fixed coordinates: the
   * slug tab scrolls and sits under a sticky nav, so an absolutely positioned
   * popover gets clipped (month header disappeared behind the tab bar). Fixed
   * coordinates clamped to the viewport cannot be clipped by any ancestor.
   */
  const place = () => {
    const trigger = rootRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const M = 8;
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const width = Math.min(320, vw - 2 * M);
    // scrollHeight excludes the borders that maxHeight (border-box) must cover,
    // otherwise the panel keeps a 2px scrollbar at its ideal height.
    const el = panelRef.current;
    const wanted = el ? el.scrollHeight + (el.offsetHeight - el.clientHeight) : 430;
    const below = vh - rect.bottom - M;
    const above = rect.top - 2 * M;
    const up = below < Math.min(wanted, 430) && above > below;
    const full = Math.min(wanted, vh - 2 * M);
    let maxHeight = Math.max(220, Math.min(wanted, up ? above : below));
    let top = up ? rect.top - M - maxHeight : rect.bottom + M;
    if (maxHeight < full) {
      // Cramped on both sides: showing a scrollable stub hides the month header,
      // so take the full height and centre it on the field instead — overlapping
      // the trigger beats hiding half the calendar.
      maxHeight = full;
      top = rect.top + rect.height / 2 - maxHeight / 2;
    }
    top = Math.min(Math.max(M, top), vh - M - maxHeight);
    const left = Math.min(Math.max(M, rect.left), vw - M - width);
    setPos({ left, top, width, maxHeight });
  };

  // Place before paint, then again once the real height is known.
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    place();
    const raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  /**
   * Follow the trigger while the panel is open. A capture-phase 'scroll' on
   * window does not fire for the lobby's inner scroll container, so bind to the
   * trigger's actual scrollable ancestors (the tab pane) as well as the window.
   */
  useEffect(() => {
    if (!open) return;
    const onMove = () => place();
    const targets: (HTMLElement | Window)[] = [window];
    for (let node = rootRef.current?.parentElement; node; node = node.parentElement) {
      const { overflowY, overflowX } = window.getComputedStyle(node);
      if (/(auto|scroll|overlay)/.test(`${overflowY} ${overflowX}`)) targets.push(node);
    }
    targets.forEach(t => t.addEventListener('scroll', onMove, { passive: true }));
    window.addEventListener('resize', onMove);
    return () => {
      targets.forEach(t => t.removeEventListener('scroll', onMove));
      window.removeEventListener('resize', onMove);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // The warning row and month length change the height — re-place on content change.
  useLayoutEffect(() => {
    if (open) place();
  }, [isPast, view, open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const inTrigger = rootRef.current?.contains(target);
      const inPanel = panelRef.current?.contains(target);
      if (!inTrigger && !inPanel) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open && keyNav) cursorRef.current?.focus();
  }, [cursor, open, keyNav]);

  const time = selected
    ? { h: selected.getHours(), m: selected.getMinutes() }
    : nextFullHour();

  const commit = (day: Date, h: number, m: number) => {
    onChange(formatLocal(new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m)));
  };

  const pickDay = (day: Date) => {
    commit(day, time.h, time.m);
    setCursor(day);
    if (day.getMonth() !== view.getMonth()) setView(day);
  };

  const setTime = (h: number, m: number) => commit(selected ?? new Date(), h, m);

  const shiftMonth = (delta: number) =>
    setView(v => new Date(v.getFullYear(), v.getMonth() + delta, 1));

  const onGridKeyDown = (e: React.KeyboardEvent) => {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let next: Date | null = null;
    if (e.key in moves) {
      next = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + moves[e.key]);
    } else if (e.key === 'PageUp') {
      next = new Date(cursor.getFullYear(), cursor.getMonth() - 1, cursor.getDate());
    } else if (e.key === 'PageDown') {
      next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate());
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pickDay(cursor);
      return;
    }
    if (!next) return;
    e.preventDefault();
    setKeyNav(true);
    setCursor(next);
    if (next.getMonth() !== view.getMonth() || next.getFullYear() !== view.getFullYear()) setView(next);
  };

  const today = new Date();
  const days = useMemo(() => monthGrid(view), [view]);

  const minutes = useMemo(() => {
    const list: number[] = [];
    for (let m = 0; m < 60; m += minuteStep) list.push(m);
    if (!list.includes(time.m)) list.push(time.m);
    return list.sort((a, b) => a - b);
  }, [minuteStep, time.m]);

  const preset = (daysAhead: number) => {
    const base = new Date();
    const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + daysAhead);
    commit(day, time.h, time.m);
    setView(day);
    setCursor(day);
  };

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-haspopup="dialog"
          aria-expanded={open}
          title={isPast ? 'This time is in the past' : undefined}
          className={`flex-1 flex items-center gap-2 px-3 py-2 bg-slate-800 border rounded text-left transition focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            open ? 'border-blue-500' : isPast ? 'border-amber-500/70 hover:border-amber-400' : 'border-slate-600 hover:border-slate-500'
          } ${selected ? 'text-white' : 'text-slate-500'}`}
        >
          <Calendar size={16} className={`shrink-0 ${isPast ? 'text-amber-400' : 'text-slate-400'}`} />
          <span className="truncate">{triggerLabel}</span>
          {isPast && (
            <span className="ml-auto flex items-center gap-1 text-xs text-amber-400 shrink-0">
              <AlertTriangle size={13} />
              Past
            </span>
          )}
        </button>
        {selected && (
          <button
            type="button"
            onClick={() => onChange('')}
            title="Clear meeting time"
            className="px-3 bg-slate-800 border border-slate-600 rounded text-slate-400 hover:text-white hover:border-slate-500 transition"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {open && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          style={{
            position: 'fixed',
            left: pos?.left ?? -9999,
            top: pos?.top ?? -9999,
            width: pos?.width ?? 320,
            maxHeight: pos?.maxHeight,
            visibility: pos ? 'visible' : 'hidden',
          }}
          className="z-[100] overflow-y-auto overscroll-contain bg-slate-900 border border-slate-700 rounded-lg shadow-xl shadow-black/50 p-3 space-y-3"
        >
          {/* Quick presets */}
          <div className="flex gap-2">
            {[['Today', 0], ['Tomorrow', 1], ['+1 week', 7]].map(([label, offset]) => (
              <button
                key={label as string}
                type="button"
                onClick={() => preset(offset as number)}
                className="flex-1 px-2 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-slate-300 transition"
              >
                {label}
              </button>
            ))}
          </div>

          {/* Month header */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              title="Previous month"
              className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-medium text-white capitalize">{monthLabel}</span>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              title="Next month"
              className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Calendar */}
          <div>
            <div className="grid grid-cols-7 mb-1">
              {weekdays.map((w, i) => (
                <div key={i} className="text-center text-[11px] font-medium text-slate-500 py-1">{w}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5" onKeyDown={onGridKeyDown}>
              {days.map(day => {
                const inMonth = day.getMonth() === view.getMonth();
                const isSelected = !!selected && sameDay(day, selected);
                const isToday = sameDay(day, today);
                const isCursor = sameDay(day, cursor);
                const isPastDay = day.getTime() < new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
                return (
                  <button
                    key={day.getTime()}
                    ref={isCursor ? cursorRef : undefined}
                    type="button"
                    tabIndex={isCursor ? 0 : -1}
                    onClick={(e) => { setKeyNav(false); e.currentTarget.focus(); pickDay(day); }}
                    className={`h-8 rounded text-sm transition focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      isSelected
                        ? 'bg-blue-600 text-white font-semibold'
                        : inMonth
                          ? `${isPastDay ? 'text-slate-500' : 'text-slate-200'} hover:bg-slate-800`
                          : 'text-slate-600 hover:bg-slate-800'
                    } ${isToday && !isSelected ? 'ring-1 ring-inset ring-blue-500/60' : ''}`}
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Time */}
          <div className="border-t border-slate-700 pt-3 space-y-2">
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-slate-400" />
              <select
                value={time.h}
                onChange={e => setTime(Number(e.target.value), time.m)}
                className="flex-1 px-2 py-1.5 bg-slate-800 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{pad(h)}</option>
                ))}
              </select>
              <span className="text-slate-500">:</span>
              <select
                value={time.m}
                onChange={e => setTime(time.h, Number(e.target.value))}
                className="flex-1 px-2 py-1.5 bg-slate-800 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {minutes.map(m => (
                  <option key={m} value={m}>{pad(m)}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-4 gap-1">
              {QUICK_TIMES.map(t => {
                const [h, m] = t.split(':').map(Number);
                const active = time.h === h && time.m === m;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTime(h, m)}
                    className={`px-1 py-1 text-xs rounded border transition ${
                      active
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>

          {isPast && (
            <div className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-300">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>This time is in the past. Pick a future date and time.</span>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-slate-700 pt-2">
            <span className="text-[11px] text-slate-500 truncate" title={timeZone}>{timeZone}</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { onChange(''); setOpen(false); }}
                className="px-2 py-1 text-xs text-slate-400 hover:text-white transition"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition"
              >
                Done
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

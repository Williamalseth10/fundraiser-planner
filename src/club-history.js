// Club records stay with the option. Research comparisons never change the event budget.
(function (root, make) {
  if (typeof module === 'object' && module.exports) module.exports = make(require('./engine.js'));
  else root.BFClubHistory = make(root.BFEngine);
})(typeof window === 'object' ? window : globalThis, function (engine) {
  'use strict';
  const limits = { golf: 50, lots: 100, comps: 25 };
  const plain = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const blank = (v) => v == null || v === '';
  const whole = (v) => Number.isSafeInteger(v) && v >= 0;
  const dollars = (v) => Number.isFinite(v) && v >= 0 && v <= 1e9 && Number(v.toFixed(2)) === v;
  const positiveText = (v) => typeof v === 'string' && !!v.trim();
  const isGolf = (o) => o.kind === 'golf_tee_times' || o.kind === 'golf_shotgun';
  const usable = (s, r) => s.isDemo || r.fictional !== true;
  const past = (v, today) => engine.isCalendarDate(v) && v <= today;

  function valid(data) {
    if (data == null) return true;
    const ids = new Set();
    const optional = (v, check) => blank(v) || check(v);
    const txt = (v, max) => v == null || (typeof v === 'string' && v.length <= max);
    const flag = (v) => v == null || typeof v === 'boolean';
    function row(r) {
      if (!plain(r) || typeof r.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(r.id) || ids.has(r.id) || !flag(r.fictional)) return false;
      ids.add(r.id);
      return true;
    }
    const list = (items, key, check) => items == null || (Array.isArray(items) && items.length <= limits[key] && items.every(check));
    const observation = (r) => row(r) && txt(r.name, 160) && txt(r.source, 300) && txt(r.notes, 300) &&
      optional(r.eventDate, engine.isCalendarDate) && flag(r.comparable);
    const golf = (r) => observation(r) && txt(r.coursePackage, 300) && optional(r.weeks, whole) &&
      optional(r.paid, whole) && optional(r.final, whole) && optional(r.price, dollars);
    const comp = (r) => observation(r) && (r.outcome == null || ['', 'sold', 'unsold'].includes(r.outcome)) &&
      optional(r.bid, dollars) && optional(r.fees, dollars);
    const lot = (r) => row(r) && txt(r.name, 160) && txt(r.notes, 300) && flag(r.donated) && flag(r.includedInLikely) &&
      optional(r.estimatedNet, dollars) && list(r.comps, 'comps', comp);
    return plain(data) && optional(data.golfWeeks, whole) && optional(data.golfAsOf, engine.isCalendarDate) &&
      list(data.golf, 'golf', golf) && list(data.lots, 'lots', lot);
  }

  function golfComparison(state, option, today) {
    const data = option.clubHistoryResearch || {};
    const paid = ((state.evidence || {}).paidRegistrations || {})[option.id];
    const result = { weeks: data.golfWeeks, paid: whole(paid) ? paid : null, matches: [], issue: '' };
    if (!isGolf(option)) return result;
    if (!whole(data.golfWeeks)) result.issue = 'Enter how many weeks remain before this event.';
    else if (data.golfAsOf !== today) result.issue = 'Confirm the weeks remaining for today’s paid count.';
    else if (!whole(paid)) result.issue = 'Enter the current paid golfer count on the Evidence step, including a confirmed zero.';
    if (result.issue) return result;
    result.matches = (data.golf || []).filter((r) => usable(state, r) && r.comparable === true &&
      past(r.eventDate, today) && positiveText(r.source) && r.weeks === data.golfWeeks && whole(r.paid))
      .map((r) => ({ record: r, difference: paid - r.paid }));
    return result;
  }

  function lotBids(state, lot, today) {
    if (!usable(state, lot)) return [];
    return (lot.comps || []).filter((r) => usable(state, r) && r.comparable === true && past(r.eventDate, today) &&
      positiveText(r.source) && (r.outcome === 'sold' ? dollars(r.bid) && r.bid > 0 :
        r.outcome === 'unsold' && (blank(r.bid) || r.bid === 0)))
      .map((r) => {
        const gross = r.outcome === 'unsold' ? 0 : r.bid;
        return { record: r, gross, net: dollars(r.fees) ? (Math.round(gross * 100) - Math.round(r.fees * 100)) / 100 : null };
      });
  }

  function auctionInventory(state, option) {
    const data = option.clubHistoryResearch || {};
    const lots = (option.kind === 'auction' ? data.lots || [] : []).filter((r) => usable(state, r))
      .map((r) => ({ id: r.id, name: r.name || 'Unnamed lot', donated: r.donated === true,
        includedInLikely: r.includedInLikely === true, estimatedNet: dollars(r.estimatedNet) ? r.estimatedNet : null }));
    const included = lots.filter((r) => r.includedInLikely);
    const known = included.filter((r) => r.estimatedNet !== null);
    return { lots, includedCount: included.length, knownIncludedCount: known.length, unknownIncludedCount: included.length - known.length,
      includedTotal: known.reduce((sum, r) => sum + Math.round(r.estimatedNet * 100), 0) / 100 };
  }
  return { limits, valid, isGolf, golfComparison, lotBids, auctionInventory, dollars, whole };
});

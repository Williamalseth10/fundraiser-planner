// Counterfactuals for the board. Nothing here changes turnout, money or evidence in the plan.
(function (root, make) {
  if (typeof module === 'object' && module.exports) module.exports = make(require('./engine.js'), require('./club-history.js'));
  else root.BFBoardQuestions = make(root.BFEngine, root.BFClubHistory);
})(typeof window === 'object' ? window : globalThis, function (engine, history) {
  'use strict';
  const cents = (value) => Math.round(value * 100);
  const difference = (a, b) => (cents(a) - cents(b)) / 100;
  const entered = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

  function paidBasis(state, option) {
    const evidence = state.evidence || {};
    const count = (evidence.paidRegistrations || {})[option.id];
    const cash = (evidence.paidCashReceived || {})[option.id];
    if (!Number.isSafeInteger(count) || count < 0) return { issue: 'paidCount' };
    if ((count > 0 && !entered(cash)) || (count === 0 && entered(cash) && cash > 0)) return { issue: 'receipts' };
    return { count, cash: cash || 0 };
  }

  function costIssue(state, option, statuses) {
    const issue = engine.optionMoneyIssue(option);
    if (issue) return issue;
    const relevant = (state.sponsorships || []).filter((s) => (!s.optionId || s.optionId === option.id) && statuses.includes(s.status));
    if (relevant.some((s) => !entered(s.amount) && (s.type !== 'inKind' ||
      (option.fixedCosts || []).some((cost) => cost.id && cost.id === s.replacesCostId)))) return 'sponsorAmount';
    return null;
  }

  function deadlines(state, option, today) {
    const contract = engine.contractChecklist(option, today);
    const dates = contract.dates.map((row) => ({ ...row, state: row.date && !engine.isCalendarDate(today) ? 'set' : row.state }));
    const by = (state.criteria || {}).decideBy;
    const board = engine.isCalendarDate(by) ? by : null;
    const days = board && engine.isCalendarDate(today) ? engine.daysBetween(today, board) : null;
    return {
      dates, quoteDate: contract.quoteDate, board: { label: 'Board decision', date: board, state: !board ? 'unknown' : days == null ? 'set' : days < 0 ? 'passed' : days === 0 ? 'today' : 'upcoming' },
    };
  }

  function golfQuestion(state, regular, shotgun, today) {
    if (!regular || !shotgun) return { issue: 'pair' };
    const timing = [regular, shotgun].map((option) => deadlines(state, option, today));
    const checks = [regular, shotgun].map((option, index) => {
      let issue = costIssue(state, option, ['collected', 'committed']);
      if (!issue && (!option.quoteVerified || !option.costsVerified)) issue = 'verifyCosts';
      if (!issue && engine.isCalendarDate(today) && timing[index].quoteDate > today) issue = 'futureQuote';
      if (!issue && timing[index].dates.some((r) => r.key === 'quoteExpires' && r.state === 'passed')) issue = 'expiredQuote';
      const paid = paidBasis(state, option);
      if (!issue) issue = paid.issue;
      if (!issue && (!engine.maxFeasible(option) || engine.normalizeParticipants(option, paid.count).participants !== paid.count)) issue = 'unusableCount';
      return { option, paid, issue };
    });
    const invalid = checks.find((row) => row.issue);
    if (invalid) return { issue: invalid.issue, optionName: invalid.option.name, timing };
    const [a, b] = checks;
    if (a.paid.count !== b.paid.count) return { issue: 'differentCounts', timing };
    if (cents(a.paid.cash) !== cents(b.paid.cash)) return { issue: 'differentReceipts', timing };
    const paid = a.paid.count;
    const firmNet = (option) => engine.project(option, paid, engine.firmContext(state, option));
    const tee = firmNet(regular), shot = firmNet(shotgun);
    const min = (state.criteria || {}).minNet;
    return {
      issue: null, paid, receipts: a.paid.cash, timing,
      teeNet: tee.net, shotgunNet: shot.net, shotgunCostDifference: difference(shot.expenses.total, tee.expenses.total),
      match: Math.max(0, difference(tee.net, shot.net)),
      minimum: entered(min) ? min : null, reachMinimum: entered(min) ? Math.max(0, difference(min, shot.net)) : null,
      upfront: shot.upfront, clubCanCoverGap: shotgun.upfrontFundingConfirmed === true,
    };
  }

  function auctionQuestion(state, option, today) {
    const inventory = history.auctionInventory(state, option);
    if (!inventory.lots.length) return { issue: 'inventory' };
    const donated = inventory.lots.filter((lot) => lot.includedInLikely && lot.donated);
    if (!donated.length) return { issue: 'noIncludedDonation' };
    if (inventory.unknownIncludedCount) return { issue: 'unknownLotValue' };
    const proceeds = (option.scenarioProceeds || {}).middle;
    if (!entered(proceeds) || cents(inventory.includedTotal) !== cents(proceeds)) return { issue: 'reconcileLots' };

    const likelyCount = (option.scenarioParticipants || {}).middle;
    if (!entered(likelyCount)) return { issue: 'missingTurnout' };
    const ctx = engine.scenarioContext(state, option, 'middle');
    const moneyIssue = costIssue(state, option, ctx.statuses);
    if (moneyIssue) return { issue: moneyIssue };
    const paid = paidBasis(state, option);
    if (paid.issue) return { issue: paid.issue };
    const normalized = engine.normalizeParticipants(option, likelyCount);
    if (!engine.maxFeasible(option) || normalized.participants < paid.count) return { issue: 'unusableCount' };
    const maxNet = Math.max(...donated.map((lot) => lot.estimatedNet));
    const largest = donated.filter((lot) => lot.estimatedNet === maxNet);
    const projection = engine.project(option, likelyCount, ctx);
    const after = difference(projection.net, maxNet);
    const min = (state.criteria || {}).minNet;
    const sources = largest.map((lot) => {
      const record = option.clubHistoryResearch.lots.find((r) => r.id === lot.id);
      return history.lotBids(state, record, today).filter((bid) => bid.net != null).length;
    });
    return {
      issue: null, names: largest.map((lot) => lot.name), lotNet: maxNet, sources, proceeds,
      likelyNet: projection.net, after, participants: normalized.participants, requested: likelyCount,
      costsConfirmed: option.quoteVerified === true && option.costsVerified === true,
      minimum: entered(min) ? min : null, vsMinimum: entered(min) ? difference(after, min) : null,
    };
  }

  return { golfQuestion, auctionQuestion };
});

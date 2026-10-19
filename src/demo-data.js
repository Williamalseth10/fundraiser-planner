/*
 * FICTIONAL DEMONSTRATION DATA.
 * Every number below is invented to exercise the calculations. None of it is a real course quote,
 * a real club's audience, real survey results, or real sponsorship. Do not use it to plan a real event.
 */
(function (root) {
  'use strict';
  const DEMO_STATE = {
    schemaVersion: 1,
    isDemo: true,
    eventName: 'Fictional Example Booster Club — Golf Fundraiser (DEMO)',
    settings: { fundraisingTarget: 5000, volunteerHourValue: null },
    snapshot: { format: 'Four-person scramble, regular tee times or shotgun start (deciding)', dateWindow: 'a Saturday in late May (example)', locationArea: '[course area — fictional]', included: 'green fee, cart, lunch, player gift', beneficiary: 'team equipment and travel (fictional)', fallbackPrice: '95' },
    volunteerHoursAvailable: null,
    scenarioSettings: {
      conservative: { label: 'Conservative', statuses: ['collected'], extraRevenuePerParticipant: 0, otherRevenue: 0, costContingencyPct: 10 },
      middle: { label: 'Middle', statuses: ['collected', 'committed'], extraRevenuePerParticipant: 10, otherRevenue: 0, costContingencyPct: 0 },
      optimistic: { label: 'Optimistic', statuses: ['collected', 'committed', 'hoped'], extraRevenuePerParticipant: 20, otherRevenue: 0, costContingencyPct: 0 },
    },
    options: [
      {
        id: 'tee', name: 'Regular tee times (fictional quote)', kind: 'golf_tee_times',
        capacity: 48, groupSize: 4, wholeGroupsOnly: true, price: 125, foursomePrice: 460, foursomeShare: 0.5,
        venueQuote: { flatFee: 0, perParticipant: 55, minimumParticipants: 0, minimumSpend: 0 },
        deposit: { amount: 250, creditedTowardBill: true, refundable: true },
        perParticipantCosts: [
          { id: 'meal', label: 'Box lunch', amount: 18 },
          { id: 'gift', label: 'Player gift', amount: 10 },
        ],
        fixedCosts: [
          { id: 'prizes', label: 'Prizes / trophies', amount: 400, paidUpfront: true },
          { id: 'signage', label: 'Signage & printing', amount: 200, paidUpfront: true },
        ],
        volunteerHours: 40, cancellationOwed: null, quoteVerified: false, costsVerified: false,
        scenarioParticipants: { conservative: 24, middle: 36, optimistic: 48 },
      },
      {
        id: 'shotgun', name: 'Shotgun start (fictional quote)', kind: 'golf_shotgun',
        capacity: 144, groupSize: 4, wholeGroupsOnly: true, price: 150, foursomePrice: 560, foursomeShare: 0.5,
        venueQuote: { flatFee: 0, perParticipant: 70, minimumParticipants: 100, minimumSpend: 0 },
        deposit: { amount: 2000, creditedTowardBill: true, refundable: false },
        perParticipantCosts: [
          { id: 'meal', label: 'Dinner', amount: 25 },
          { id: 'gift', label: 'Player gift', amount: 10 },
        ],
        fixedCosts: [
          { id: 'prizes', label: 'Prizes / trophies', amount: 800, paidUpfront: true },
          { id: 'signage', label: 'Hole signs & printing', amount: 450, paidUpfront: true },
        ],
        volunteerHours: 90, cancellationOwed: 2000, quoteVerified: false, costsVerified: false,
        scenarioParticipants: { conservative: 72, middle: 104, optimistic: 136 },
      },
      {
        id: 'alt', name: 'Alternative: generic non-golf event (fictional)', kind: 'generic',
        capacity: 120, groupSize: 1, wholeGroupsOnly: false, price: 35, foursomePrice: null, foursomeShare: 0,
        venueQuote: { flatFee: 300, perParticipant: 0, minimumParticipants: 0, minimumSpend: 0 },
        deposit: { amount: 100, creditedTowardBill: true, refundable: false },
        perParticipantCosts: [{ id: 'meal', label: 'Food', amount: 12 }],
        fixedCosts: [{ id: 'prizes', label: 'Prizes', amount: 150, paidUpfront: true }],
        volunteerHours: 30, quoteVerified: false, costsVerified: false,
        scenarioParticipants: { conservative: 50, middle: 80, optimistic: 110 },
      },
    ],
    sponsorships: [
      { id: 's1', label: 'Hole sponsor A (fictional)', amount: 500, status: 'collected', type: 'cash', optionId: '' },
      { id: 's2', label: 'Hole sponsors B–D (fictional)', amount: 1500, status: 'committed', type: 'cash', optionId: '' },
      { id: 's3', label: 'Title sponsor prospect (fictional)', amount: 3000, status: 'hoped', type: 'cash', optionId: '' },
      { id: 's4', label: 'Donated sign printing (fictional)', amount: 300, status: 'committed', type: 'inKind', replacesCostId: 'signage', optionId: '' },
      { id: 's5', label: 'Donated raffle baskets (fictional)', amount: 400, status: 'hoped', type: 'inKind', replacesCostId: '', optionId: '' },
    ],
    evidence: {
      surveyResponses: 46,
      namedHighIntent: { tee: 6, shotgun: 9, alt: 12 },
      surveyDefinitelyAtPrice: { tee: 14, shotgun: 22, alt: 30 },
      surveyProbablyAtPrice: { tee: 12, shotgun: 20, alt: 25 },
      paidRegistrations: { tee: 0, shotgun: 0, alt: 0 },
      notes: 'FICTIONAL survey summary for demonstration only.',
    },
  };

  const BLANK_STATE = {
    schemaVersion: 1,
    isDemo: false,
    eventName: 'New fundraiser',
    settings: { fundraisingTarget: 0, volunteerHourValue: null },
    snapshot: { format: '', dateWindow: '', locationArea: '', included: '', beneficiary: '', fallbackPrice: '' },
    volunteerHoursAvailable: null,
    scenarioSettings: JSON.parse(JSON.stringify(DEMO_STATE.scenarioSettings)),
    options: [
      {
        id: 'opt1', name: 'Option 1', kind: 'golf_tee_times', capacity: 0, groupSize: 4, wholeGroupsOnly: true, price: 0, foursomePrice: null, foursomeShare: 0,
        venueQuote: { flatFee: 0, perParticipant: 0, minimumParticipants: 0, minimumSpend: 0 },
        deposit: { amount: 0, creditedTowardBill: true, refundable: false },
        perParticipantCosts: [], fixedCosts: [], volunteerHours: 0, quoteVerified: false, costsVerified: false,
        scenarioParticipants: { conservative: 0, middle: 0, optimistic: 0 },
      },
    ],
    sponsorships: [],
    evidence: { surveyResponses: 0, namedHighIntent: {}, surveyDefinitelyAtPrice: {}, surveyProbablyAtPrice: {}, paidRegistrations: {}, notes: '' },
  };
  BLANK_STATE.scenarioSettings.middle.extraRevenuePerParticipant = 0;
  BLANK_STATE.scenarioSettings.optimistic.extraRevenuePerParticipant = 0;
  BLANK_STATE.scenarioSettings.conservative.costContingencyPct = 10;

  const api = { DEMO_STATE, BLANK_STATE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BFDemo = api;
})(typeof window !== 'undefined' ? window : globalThis);

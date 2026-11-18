// Starting structure for a new fundraiser. Scenario participant counts stay blank until entered.
(function (root) {
  'use strict';
  const BLANK_STATE = {
    schemaVersion: 1,
    isDemo: false,
    eventName: 'New fundraiser',
    settings: { fundraisingTarget: 0, volunteerHourValue: null },
    snapshot: { format: '', dateWindow: '', locationArea: '', included: '', beneficiary: '', fallbackPrice: '' },
    volunteerHoursAvailable: null,
    scenarioSettings: {
      conservative: { label: 'Conservative', statuses: ['collected'], extraRevenuePerParticipant: 0, otherRevenue: 0, costContingencyPct: 10 },
      middle: { label: 'Middle', statuses: ['collected', 'committed'], extraRevenuePerParticipant: 0, otherRevenue: 0, costContingencyPct: 0 },
      optimistic: { label: 'Optimistic', statuses: ['collected', 'committed', 'hoped'], extraRevenuePerParticipant: 0, otherRevenue: 0, costContingencyPct: 0 },
    },
    options: [
      {
        id: 'opt1', name: 'Option 1', kind: 'golf_tee_times', capacity: null, groupSize: 4, wholeGroupsOnly: true, price: null, groupPrice: null, groupShare: 0,
        venueQuote: { flatFee: null, perParticipant: null, minimumParticipants: null, minimumSpend: null },
        deposit: { amount: null, creditedTowardBill: null, refundable: null },
        perParticipantCosts: [], fixedCosts: [], volunteerHours: null, cancellationOwed: null, quoteVerified: false, costsVerified: false,
        scenarioParticipants: { conservative: null, middle: null, optimistic: null },
      },
    ],
    sponsorships: [],
    evidence: { surveyResponses: 0, namedHighIntent: {}, surveyDefinitelyAtPrice: {}, surveyProbablyAtPrice: {}, paidRegistrations: {}, notes: '' },
  };
  const api = { BLANK_STATE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BFPlan = api;
})(typeof window !== 'undefined' ? window : globalThis);

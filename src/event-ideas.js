// Match available club resources to event formats worth pricing.
(function (root) {
  'use strict';

  const signals = [
    { id: 'donations', label: 'Donors have offered auction items.' },
    { id: 'bidders', label: 'We can reach people who asked to bid.' },
    { id: 'golfers', label: 'We can reach golfers who want to play.' },
    { id: 'course', label: 'A golf course gave us a written quote.' },
    { id: 'venue', label: 'A venue offered us space for a gathering.' },
    { id: 'supplier', label: 'A supplier offered to fill preorders.' },
    { id: 'walkLead', label: 'A volunteer can lead a walk or fun run.' },
    { id: 'limitCash', label: 'We need to limit what we pay upfront.' }
  ];

  const formats = [
    {
      kind: 'auction', title: 'Auction', entry: ['donations', 'bidders'],
      reasons: {
        donations: 'Donors have offered items you could put up for bid.',
        bidders: 'You have a way to reach interested bidders.',
        venue: 'You also have a possible place to hold it.'
      },
      next: (s) => !s.has('donations') ? 'Get specific items pledged before estimating bids.'
        : !s.has('bidders') ? 'Ask potential bidders which items interest them. Check past winning bids and unsold lots before estimating proceeds.'
        : 'Check past winning bids, unsold lots and selling fees for similar items before estimating net bids.',
      cash: 'Check platform and venue costs due before bids are collected.'
    },
    {
      kind: 'golf_tee_times', title: 'Golf outing with tee times', entry: ['course', 'golfers'],
      reasons: {
        golfers: 'You already have a way to reach interested golfers.',
        course: 'You have a written course quote to check against ticket revenue.'
      },
      next: (s) => !s.has('course') ? 'Ask the course for tee-time and shotgun quotes with the player minimum, deposit and cancellation terms.'
        : !s.has('golfers') ? 'Confirm the quote covers regular tee times. Ask golfers whether they would register at a specific single or foursome price.'
        : 'Test a specific player and foursome price with those golfers. Compare tee times with a shotgun start if you have quotes for both.',
      cash: 'Check how much of the course deposit is at risk before registrations are paid.'
    },
    {
      kind: 'product', title: 'Preorder sale', entry: ['supplier'],
      reasons: { supplier: 'A supplier can fill preorders, so you can price the sale before ordering stock.' },
      next: () => 'Get the unit cost, minimum order and delivery charges. Ask families what they would actually order at the proposed price.',
      cash: 'Confirm payments will clear before the supplier needs money.'
    },
    {
      kind: 'ticketed', title: 'Ticketed dinner or trivia night', entry: ['venue'],
      reasons: { venue: 'You have a possible place to bring paying guests together.' },
      next: () => 'Get the room cost, food minimum and cancellation terms. Ask families whether they would buy a ticket at the proposed price.',
      cash: 'Check whether the venue takes a nonrefundable deposit before tickets go on sale.'
    },
    {
      kind: 'participation', title: 'Walk or fun run', entry: ['walkLead'],
      reasons: { walkLead: 'A volunteer can take the lead on organizing the event.' },
      next: () => 'Confirm route permission, insurance costs and volunteer coverage. Ask families about signing up at a specific price.',
      cash: 'Ask which route and insurance costs are due before sign-ups.'
    }
  ];

  function selectedSet(ids) {
    return new Set(ids instanceof Set || Array.isArray(ids) ? ids : []);
  }

  function suggestIdeas(ids) {
    const selected = selectedSet(ids);
    const candidates = formats.filter((format) => format.entry.some((id) => selected.has(id)));
    const matches = candidates.map((format) => {
      const reasons = Object.entries(format.reasons)
        .filter(([id]) => selected.has(id))
        .map(([, reason]) => reason);
      return {
        kind: format.kind, title: format.title, reasons, next: format.next(selected),
        cashCheck: selected.has('limitCash') ? format.cash : ''
      };
    });
    return matches.sort((a, b) => b.reasons.length - a.reasons.length || a.title.localeCompare(b.title, 'en')).slice(0, 3);
  }

  const api = { signals, suggestIdeas };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BFEventIdeas = api;
})(typeof window !== 'undefined' ? window : globalThis);

(function (root) {
  'use strict';
  const ideas = typeof module !== 'undefined' && module.exports ? require('./event-ideas.js') : root.BFEventIdeas;

  function renderMatches({ selected = [], hasPlan = false, existingKinds = [] } = {}) {
    const matches = ideas.suggestIdeas(selected);
    const chosen = new Set(selected);
    const existing = new Set(existingKinds);
    if (!matches.length) {
      const instruction = chosen.has('limitCash')
        ? 'What does the club already have that could help keep spending low? A supplier willing to fill preorders is one place to start.'
        : 'Choose a resource above to see an event you could explore.';
      return '<p class="hint">' + instruction + '</p>';
    }
    // All content comes from the fixed format catalogue. Input values only select entries.
    const cards = matches.map((match) => {
      const action = hasPlan && existing.has(match.kind)
        ? '<p class="hint">Already in your plan. <a href="#step-options">Review my options</a></p>'
        : '<button type="button" class="small" data-action="choose-event-idea" data-kind="' + match.kind + '">' +
          (hasPlan ? 'Add to my plan' : 'Start a plan') + '<span class="sr-only"> for ' + match.title + '</span></button>';
      return '<article class="idea-card"><h3>' + match.title + '</h3><p>' + match.reasons.join(' ') + '</p>' +
        '<p><strong>Check first.</strong> ' + match.next + '</p>' +
        (match.cashCheck ? '<p><strong>Before paying.</strong> ' + match.cashCheck + '</p>' : '') + action + '</article>';
    });
    return '<p class="hint">Showing up to three ideas, with the most matching resources first. Prices and turnout are yours to check.</p>' +
      '<div class="idea-cards">' + cards.join('') + '</div>';
  }

  function render(settings = {}) {
    const selected = new Set(settings.selected || []);
    const checks = ideas.signals.map(({ id, label }) => {
      return '<label class="chk"><input type="checkbox" data-idea-signal="' + id + '"' +
        (selected.has(id) ? ' checked' : '') + '><span>' + label + '</span></label>';
    });
    return '<section class="panel event-ideas" aria-labelledby="event-ideas-title"><h1 id="event-ideas-title" tabindex="-1">Find a fundraiser to explore</h1>' +
      '<fieldset class="checks-set"><legend>What does the club already know?</legend>' + checks.join('') + '</fieldset>' +
      '<div id="event-idea-matches" aria-live="polite">' + renderMatches(settings) + '</div>' +
      '<p><a href="#home">' + (settings.hasPlan ? 'Back to my plan' : 'Choose a fundraiser type myself') + '</a></p></section>';
  }

  const api = { render, renderMatches };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BFEventIdeasUI = api;
})(typeof window !== 'undefined' ? window : globalThis);

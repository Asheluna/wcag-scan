const axe = require("axe-core");
const rules = axe.getRules(["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa","best-practice"]);
const criteriaMap = {};
rules.forEach(r => {
  r.tags.filter(t => /^wcag\d{3,}$/.test(t)).forEach(t => {
    const match = t.match(/^wcag(\d)(\d)(\d+)$/);
    if (match) {
      const key = match[1] + "." + match[2] + "." + match[3];
      if (!criteriaMap[key]) criteriaMap[key] = [];
      criteriaMap[key].push(r.ruleId);
    }
  });
});
const bpOnly = rules.filter(r => !r.tags.some(t => /^wcag\d{3,}$/.test(t)));
Object.keys(criteriaMap).sort((a,b) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  return pa[0]-pb[0] || pa[1]-pb[1] || pa[2]-pb[2];
}).forEach(k => {
  console.log(k + " (" + criteriaMap[k].length + " rules): " + criteriaMap[k].join(", "));
});
console.log("\nBest-practice only (" + bpOnly.length + " rules): " + bpOnly.map(r=>r.ruleId).join(", "));

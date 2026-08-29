import yaml from 'js-yaml';
import fs from 'node:fs';
const d = yaml.load(fs.readFileSync('.github/workflows/ci.yml','utf8'));
console.log(Object.keys(d.jobs));
console.log(d.jobs['pos-sellable-transition-postgres'].steps.map(s=>s.name||s.uses));

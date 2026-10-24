// The first-steps guide: a short list of what to do first, one step at a time, under the projects tracker. Each
// step is done when the colony shows it done, so the guide follows whatever order the player actually plays in,
// and a colony that is further along skips ahead. It can be hidden from the menu, and closes itself at the end.
const $ = id => document.getElementById(id);
const KEY = 'colony-guide';
const has = (U, type) => U.projects.some(p => p.type === type);
const crew = (U, work) => U.crews.some(c => !c.gone && c.work === work && c.members.length);

export const STEPS = [
  {
    title: 'Wake the first founders', tab: 'archive', btn: 'Open the Archive',
    text: 'The Seed carries forty founders as stored minds, and feedstock for six bodies. In the Archive, keep the Seed’s pick or choose your own six, then press Print. Each body takes about four hours.',
    done: U => U.seed.queue.length > 0 || !!U.seed.printing || U.alive > 0,
  },
  {
    title: 'Let the shelter go up', tab: 'crews', btn: 'See the crews',
    text: 'As each founder wakes, the Seed puts them in a crew. Builders turn the lander’s modules into a shelter with twelve bunks; surveyors plant sensor stakes to map the land. It takes a few days. <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> set the speed and <kbd>Space</kbd> pauses.',
    done: U => U.shelter.done,
  },
  {
    title: 'Test the local stone and timber', tab: 'build:mat', btn: 'Open Materials',
    text: 'In the Build window, under Materials, start a load test for each. Until a material is tested, every design carries 40% extra as a safety margin.',
    done: U => ['stone', 'timber'].every(m => U.mat[m].tested || U.projects.some(p => p.type === 'test' && p.mat === m)),
  },
  {
    title: 'Send someone foraging', tab: 'crews', btn: 'Open Crews',
    text: 'The lander’s rations won’t last. In Crews, make a new crew, set its work to Forage, and move one or two people into it. Foragers bring in wild food and biomass, and take samples of the local life.',
    done: U => crew(U, 'forage'),
  },
  {
    title: 'Find out what is safe to eat', tab: 'life:local', btn: 'Open Local life',
    text: 'Nothing here is food until a test says so. In the Life window, under Local life, press Test it on anything with three samples. Some food needs a kitchen crew to leach or ferment it first.',
    done: U => !!U.F && U.F.life.some(l => l && (l.tested || l.queued)),
  },
  {
    title: 'Plan a field', tab: 'build:plan', btn: 'Open Plan',
    text: 'In the Build window, under Plan, pick Field and drag it out near camp, then confirm. Build crews make the soil in five stages.',
    done: U => has(U, 'field'),
  },
  {
    title: 'Put someone on the farm', tab: 'crews', btn: 'Open Crews',
    text: 'A field needs a farm crew to sow and harvest it. In Crews, give a crew Farm work; the Seed picks a crop that can ripen before the frost.',
    done: U => crew(U, 'farm'),
  },
  {
    title: 'Power and parts', tab: 'build:plan', btn: 'Open Plan',
    text: 'Buildings only work with power, and the lander makes just 8 kW. Plan a solar field for more, and a workshop: its benches make airlock seals, pipes and power units from salvage, far faster than the fabricator.',
    done: U => has(U, 'solar') && has(U, 'workshop'),
  },
  {
    title: 'Grow the colony', tab: 'build:plan', btn: 'Open Plan',
    text: 'After the first six, every new person needs feedstock. Plan a feedstock plant, give it power, and set up a quarry crew: the plant turns biomass and stone into feedstock for one more body every couple of days.',
    done: U => has(U, 'plant'),
  },
];
const END = { title: 'You’re on your way', text: 'The rest is yours to work out. Fill the larder before Deep cold, build a commons and dormitories to ease strain, and a clinic for the hurt. Letters on the right tell you what happens, and the alerts under them say what needs attention.' };

export class Guide {
  constructor(A, api) {
    this.A = A; this.api = api; this.sig = '';
    let st = {}; try { st = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { /* private window */ }
    this.off = !!st.off; this.min = !!st.min;
    $('gBody').addEventListener('click', e => {
      const b = e.target.closest('[data-g]'); if (!b) return;
      if (b.dataset.g === 'go') this.api.tab(b.dataset.tab);
      else if (b.dataset.g === 'end') this.set(true);
    });
    $('gMin').onclick = () => { this.min = !this.min; this.keep(); this.sig = ''; this.update(this.A.ui); };
    $('nGuide').checked = !this.off;
    $('nGuide').onchange = e => this.set(!e.target.checked);
  }
  keep() { try { localStorage.setItem(KEY, JSON.stringify({ off: this.off, min: this.min })); } catch (e) { /* not kept */ } }
  set(off) { this.off = off; this.min = false; $('nGuide').checked = !off; this.keep(); this.sig = ''; this.update(this.A.ui); }
  update(U) {
    const el = $('guide'), A = this.A;
    if (this.off || !U || U.mode !== 'landfall' || A.phase !== 'colony' || !A.panels || !A.panels.on) { el.hidden = true; this.sig = ''; return; }
    const i = STEPS.findIndex(s => !s.done(U)), sig = [i, this.min].join('|');
    el.hidden = false;
    if (sig === this.sig) return; this.sig = sig;
    const n = STEPS.length, s = i < 0 ? END : STEPS[i];
    $('gN').textContent = i < 0 ? 'Done' : `${i + 1} of ${n}`;
    $('gMin').textContent = this.min ? 'Show' : 'Hide';
    let h = `<div class="gdots">${STEPS.map((_, k) => `<i class="${i < 0 || k < i ? 'd' : k === i ? 'c' : ''}"></i>`).join('')}</div><b>${s.title}</b>`;
    if (!this.min) h += `<p>${s.text}</p><div class="gact">${i < 0 ? '<button class="go" data-g="end">Close the guide</button>' : `<button class="pill" data-g="go" data-tab="${s.tab}">${s.btn}</button>`}</div>`;
    $('gBody').innerHTML = h;
  }
}

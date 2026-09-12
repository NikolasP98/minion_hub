import { Application, Ticker } from 'pixi.js';
import * as classic from '../../../src/lib/workshop/agent-sprite';
import * as habbo from '../../../src/lib/workshop/habbo-renderer';
import * as elements from '../../../src/lib/workshop/habbo-element-sprite';
import * as physics from '../../../src/lib/workshop/physics';

const app = new Application();
await app.init({ width: 360, height: 240, preference: 'webgl', backgroundAlpha: 0 });
document.body.appendChild(app.canvas);
const info = { agentId: 'fixture', name: 'Fixture', avatarSeed: 'fixture' };
const a = await classic.createAgentSprite('classic', info, 80, 100, app.stage);
const b = await habbo.createHabboAvatarSprite('habbo', info, app, app.stage);
b.position.set(220, 100);
a.scale.set(1.3, 1.6);
b.scale.set(1.2, 1.5);
const glow = a.getChildByLabel('glow')!;
glow.alpha = 0.4;
const element = elements.createHabboElementSprite(
  'board',
  'pinboard',
  'Board',
  160,
  180,
  app.stage,
);
await physics.initPhysics();
physics.addAgentBody('moving', 100, 0);
physics.makeAgentDynamic('moving');
let steps = 0;
const physicsTick = () => {
  physics.applyWanderImpulse('moving', 0, 0, 0);
  physics.step();
  steps++;
};
Ticker.shared.add(physicsTick);
let destroyed = false;
const snapshot = () => ({
  ready: true,
  steps,
  position: physics.getAgentPosition('moving'),
  destroyed,
  classic: a.destroyed ? null : { scale: [a.scale.x, a.scale.y], alpha: glow.alpha },
  habbo: b.destroyed ? null : { scale: [b.scale.x, b.scale.y] },
  hover: element.destroyed ? null : element.getChildByLabel('icon')!.y,
  reactions: [a, b].map((container) =>
    container.destroyed
      ? []
      : container.children
          .filter((child) => child.label === 'fixture-reaction')
          .map((child) => ({ y: child.y, alpha: child.alpha })),
  ),
  tickerCount: Ticker.shared.count,
});
function react() {
  classic.showReactionEmoji('classic', '✓');
  habbo.showReactionEmoji('habbo', '✓');
  a.children.at(-1)!.label = 'fixture-reaction';
  b.children.at(-1)!.label = 'fixture-reaction';
}
Object.assign(window, {
  __motion: {
    snapshot,
    pulse: () => {
      classic.triggerHeartbeatPulse('classic');
      habbo.triggerHeartbeatPulse('habbo');
    },
    react,
    move: () => physics.setAgentPosition('moving', 400, 20),
    destroySprites: () => {
      a.destroy({ children: true });
      b.destroy({ children: true });
      element.destroy({ children: true });
    },
    stop: () => {
      Ticker.shared.remove(physicsTick);
      physics.destroyPhysics();
      destroyed = true;
      app.destroy(true, { children: true });
    },
  },
});
document.body.dataset.ready = 'true';

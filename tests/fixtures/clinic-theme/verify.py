"""Run through browser-harness from the Hub directory; no production API calls."""
import json
from pathlib import Path
import shutil

out = Path('test-results/clinic-theme')
out.mkdir(parents=True, exist_ok=True)
results = []

def settle():
    # Keep native animation/focus events active in this dedicated headless tab.
    cdp('Emulation.setFocusEmulationEnabled', enabled=True)
    js("document.fonts.ready.then(() => new Promise(resolve => setTimeout(resolve, 600)))")

def shot(name):
    shutil.copy2(capture_screenshot(), out / (name + '.png'))

def click_button(label):
    point = js("(() => { const el = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === " + json.dumps(label) + "); const r = el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()")
    click_at_xy(point['x'], point['y'])
    settle()

def key(name, code):
    press_key(name)

def wait_for_dialog_close():
    assert js("""(async () => {
        const deadline = performance.now() + 5000;
        do {
            if (!document.querySelector('dialog[open]') &&
                document.activeElement?.innerText?.trim() === 'Open dialog') return true;
            await new Promise(resolve => setTimeout(resolve, 50));
        } while (performance.now() < deadline);
        return false;
    })()"""), 'Dialog did not close and restore focus within 5 seconds'

cdp('Emulation.setDeviceMetricsOverride', **{'width': 1440, 'height': 1000, 'deviceScaleFactor': 1, 'mobile': False})
new_tab('http://127.0.0.1:18913/')
cdp('Page.bringToFront')
cdp('Emulation.setDeviceMetricsOverride', **{'width': 1440, 'height': 1000, 'deviceScaleFactor': 1, 'mobile': False})
wait_for_load()
settle()
shot('initial')
for mode in ['light', 'dark']:
    click_button('Clinic ' + mode.title())
    state = js("fetch('/tokens.json').then(r=>r.json()).then(tokens=>({count:tokens.length,missing:tokens.filter(t=>!getComputedStyle(document.documentElement).getPropertyValue(t).trim()),theme:document.documentElement.dataset.minionTheme,scheme:getComputedStyle(document.documentElement).colorScheme,overflow:document.documentElement.scrollWidth>innerWidth}))")
    assert state == {'count': 169, 'missing': [], 'theme': 'clinic-' + mode, 'scheme': mode, 'overflow': False}, state
    shot(mode + '-desktop')
    js('location.reload()')
    wait_for_load()
    settle()
    assert js('document.documentElement.dataset.minionTheme') == 'clinic-' + mode
    click_button('Open dialog')
    assert js("!!document.querySelector('dialog[open]') && document.querySelector('dialog[open]').contains(document.activeElement)")
    for _ in range(6):
        key('Tab', 9)
        # Native dialogs may pass focus to browser chrome (activeElement=body).
        # Background page controls must remain outside the focus sequence.
        assert js("document.activeElement === document.body || document.querySelector('dialog[open]').contains(document.activeElement)")
    shot(mode + '-dialog')
    # Return from browser chrome to the document before testing Escape.
    point = js("(() => {const r=document.querySelector('dialog[open] input').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()")
    click_at_xy(point['x'], point['y'])
    key('Escape', 27)
    wait_for_dialog_close()
    print('Desktop passed: ' + mode, flush=True)
    results.append({'mode': mode, 'tokens': state, 'reload': True, 'dialog': True, 'preventsBackgroundFocus': True, 'escapeRestoresFocus': True})

cdp('Emulation.setDeviceMetricsOverride', **{'width': 390, 'height': 844, 'deviceScaleFactor': 1, 'mobile': False})
settle()
shot('mobile-initial')
for mode in ['dark', 'light']:
    js('scrollTo(0,0)')
    click_button('Clinic ' + mode.title())
    assert js('document.documentElement.scrollWidth <= innerWidth')
    shot(mode + '-mobile')
    click_button('Open dialog')
    assert js("(() => {const r=document.querySelector('dialog[open]').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth;})()")
    shot(mode + '-mobile-dialog')
    key('Escape', 27)
    wait_for_dialog_close()
    print('Mobile passed: ' + mode, flush=True)
    results.append({'mode': mode, 'mobileWidth': 390, 'overflow': False, 'dialogFits': True})

# Exercise the actual appearance page, including the real selector callback.
js("document.querySelector('.appearance-proof').open = true; document.querySelector('.appearance-proof').scrollIntoView()")
settle()
shot('appearance-mobile')
js("document.querySelector('button[title=\"Clinic Dark\"]').scrollIntoView({block:'center'})")
settle()
shot('picker-before')
point = js("(() => {const r=document.querySelector('button[title=\"Clinic Dark\"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()")
click_at_xy(point['x'], point['y'])
settle()
assert js('document.documentElement.dataset.minionTheme') == 'clinic-dark'
assert js("JSON.parse(localStorage.getItem('minion-hub-theme')).presetId") == 'clinic-dark'
assert js('document.documentElement.scrollWidth <= innerWidth')
shot('picker-dark-mobile')
results.append({'actualAppearancePicker': True, 'persisted': True, 'mobileOverflow': False})
(out / 'browser-results.json').write_text(json.dumps(results, indent=2) + '\n')
print(json.dumps(results, indent=2))

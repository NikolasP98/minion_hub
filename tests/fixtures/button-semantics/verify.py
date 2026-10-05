"""Run through Browser Harness against the two immutable local fixture builds."""
import base64
import json
import os
import re
from urllib.parse import urlsplit
import time
from pathlib import Path, PurePosixPath

out = Path(os.environ['MINION_BUTTON_EVIDENCE_OUT']).resolve()
if not out.is_dir():
    raise ValueError('Evidence output must be an existing directory')

def fixture_url(value):
    parsed = urlsplit(value)
    if (parsed.scheme != 'http' or parsed.hostname not in {'127.0.0.1', 'localhost'}
            or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in {'', '/'} or parsed.port is None or not 1024 <= parsed.port <= 65535):
        raise ValueError('Only explicit loopback HTTP fixture origins with ports1024-65535 are allowed')
    return value

def proof_name(value):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*\.json', value):
        raise ValueError('Proof filename must be one plain JSON basename')
    return value

def manifest_label(value):
    label = PurePosixPath(value)
    if (label.is_absolute() or '..' in label.parts or '\\' in value or ':' in value
            or label.name != 'fixture-manifest.json'):
        raise ValueError('Fixture manifest label must be a relative non-traversing path')
    actual = (out / value).resolve(strict=True)
    if not actual.is_relative_to(out) or not actual.is_file():
        raise ValueError('Fixture manifest must exist within the evidence root')
    return value

before_url = fixture_url(os.environ.get('MINION_BUTTON_BEFORE_URL', 'http://127.0.0.1:4427'))
after_url = fixture_url(os.environ.get('MINION_BUTTON_AFTER_URL', 'http://127.0.0.1:4426'))
proof_file = proof_name(os.environ.get('MINION_BUTTON_PROOF_FILE', 'hc038-native-proof-v2.json'))
manifest_labels = [manifest_label(os.environ.get('MINION_BUTTON_BEFORE_MANIFEST', 'hc038-native-before-v2/fixture-manifest.json')), manifest_label(os.environ.get('MINION_BUTTON_AFTER_MANIFEST', 'hc038-native-after-v2/fixture-manifest.json'))]
if (out / proof_file).exists():
    raise ValueError('Evidence proof must be fresh; do not overwrite a captured run')
proof = {'scope': 'HC038 actual packed Button and actual FlowExports native controls', 'productionWrites': 0, 'cases': []}

def read(target, expression):
    return js(expression, target_id=target)

def ready(target):
    for _ in range(40):
        if read(target, "Boolean(document.querySelector('#probe'))"):
            return
        time.sleep(.05)
    raise AssertionError('Fixture did not mount')

def key(session, name):
    code, vk, text = {'Tab': ('Tab', 9, ''), 'Enter': ('Enter', 13, '\r'), ' ': ('Space', 32, ' ')}[name]
    extra = {'text': text, 'unmodifiedText': text} if text else {}
    cdp('Input.dispatchKeyEvent', session_id=session, type='keyDown', key=name, code=code, windowsVirtualKeyCode=vk, **extra)
    cdp('Input.dispatchKeyEvent', session_id=session, type='keyUp', key=name, code=code, windowsVirtualKeyCode=vk)
    time.sleep(.04)

def click(target, session, selector):
    rectangle = read(target, f"(() => {{const e=document.querySelector({json.dumps(selector)}); e.scrollIntoView({{block:'center'}}); const r=e.getBoundingClientRect(); return {{x:r.x+r.width/2,y:r.y+r.height/2}};}})()")
    for action in ['mousePressed', 'mouseReleased']:
        cdp('Input.dispatchMouseEvent', session_id=session, type=action, button='left', clickCount=1, **rectangle)
    time.sleep(.04)

def focus(target, selector):
    read(target, f"document.querySelector({json.dumps(selector)}).focus()")

def count(target, name):
    return int(read(target, f"document.querySelector('#{name}').textContent"))

def shot(target, session, name):
    name = Path(proof_file).stem + '-' + name
    with (out / name).open('xb') as image:
        image.write(base64.b64decode(cdp('Page.captureScreenshot', session_id=session, format='png')['data']))
    return name

def ax(session):
    wanted = {'Unselected option', 'Selected option', 'Report switch', 'Report', 'Disabled link', 'Loading link'}
    return [{'name': n.get('name', {}).get('value'), 'role': n.get('role', {}).get('value'), 'properties': {p['name']: p['value'].get('value') for p in n.get('properties', [])}}
            for n in cdp('Accessibility.getFullAXTree', session_id=session)['nodes'] if not n.get('ignored') and n.get('name', {}).get('value') in wanted and n.get('role', {}).get('value') not in ['StaticText', 'InlineTextBox']]

before = new_tab(before_url)
bs = cdp('Target.attachToTarget', targetId=before, flatten=True)['sessionId']
cdp('Emulation.setDeviceMetricsOverride', session_id=bs, width=1100, height=1050, deviceScaleFactor=1, mobile=False)
ready(before)
key(bs, 'Tab')
assert read(before, 'document.activeElement.id') == 'skip'
assert read(before, "document.querySelector('#skip').getAttribute('tabindex')") is None
before_ax = ax(bs)
assert any(n['name'] == 'Report' and n['role'] == 'button' for n in before_ax)
proof['before'] = {'target': before, 'firstTab': 'skip', 'accessibility': before_ax, 'screenshot': shot(before, bs, 'hc038-before-native-focus.png')}

after = new_tab(after_url)
s = cdp('Target.attachToTarget', targetId=after, flatten=True)['sessionId']
cdp('Emulation.setDeviceMetricsOverride', session_id=s, width=1100, height=1050, deviceScaleFactor=1, mobile=False)
ready(after)
sequence = []
for expected in ['reach', 'probe', 'enabled-link', 'disable']:
    key(s, 'Tab')
    actual = read(after, 'document.activeElement.id')
    assert actual == expected, (actual, expected)
    sequence.append(actual)
    if expected == 'reach': shot(after, s, 'hc038-after-native-focus.png')
proof['cases'].append({'case': 'native Tab skips roving -1 and disabled/loading links', 'sequence': sequence})
after_ax = ax(s)
assert any(n['name'] == 'Selected option' and n['role'] == 'option' for n in after_ax)
assert any(n['name'] == 'Report' and n['role'] == 'switch' for n in after_ax)
proof['cases'].append({'case': 'actual accessibility tree preserves caller roles', 'accessibility': after_ax})
click(after, s, '#probe')
assert count(after, 'activations') == 1
key(s, 'Enter'); assert count(after, 'activations') == 2
key(s, ' '); assert count(after, 'activations') == 3
proof['cases'].append({'case': 'pointer Enter and Space each invoke the native control once', 'activations': 3})
for control, busy in [('disable', None), ('load', 'true')]:
    click(after, s, '#' + control)
    assert read(after, "document.querySelector('#probe').disabled") is True
    assert read(after, "document.querySelector('#probe').getAttribute('aria-busy')") == busy
    click(after, s, '#probe')
    assert count(after, 'activations') == 3
    proof['cases'].append({'case': control + ' blocks native pointer activation', 'activations': 3})
click(after, s, '#enable'); focus(after, '#probe'); key(s, 'Enter')
assert count(after, 'activations') == 4
click(after, s, '#role')
assert read(after, "document.querySelector('#probe').getAttribute('role')") == 'radio'
focus(after, '#probe'); key(s, ' ')
assert count(after, 'activations') == 5
proof['cases'].append({'case': 're-enable and reactive switch-to-radio preserve native activation', 'activations': 5})
focus(after, '#default'); key(s, 'Enter'); assert count(after, 'submits') == 0
focus(after, '#submit'); key(s, 'Enter'); assert count(after, 'submits') == 1
focus(after, '#reset'); key(s, ' '); assert count(after, 'resets') == 1
for selector in ['#disabled-submit', '#loading-submit']:
    click(after, s, selector)
    assert count(after, 'submits') == 1
proof['cases'].append({'case': 'default submit reset and disabled/loading submit preserve native form behavior', 'submits': 1, 'resets': 1})
focus(after, '#enabled-link'); key(s, 'Enter'); assert count(after, 'links') == 1
assert read(after, 'location.hash') == '#local-destination'
key(s, ' '); assert count(after, 'links') == 1
for selector in ['#disabled-link', '#loading-link']:
    assert read(after, f"document.querySelector({json.dumps(selector)}).hasAttribute('href')") is False
    click(after, s, selector)
    assert count(after, 'links') == 1
proof['cases'].append({'case': 'native anchor Enter navigates once; Space and disabled/loading links do not navigate', 'linkActivations': 1})
focus(after, '[title="Report"]'); key(s, 'Enter'); key(s, ' ')
requests = read(after, 'window.__buttonEvidence.requests')
assert requests == [
    {'path': '/api/flows/flow%2F%252F%2F%E6%9D%B1%E4%BA%AC/exports', 'method': 'PATCH', 'body': {'varKey': 'report/%2F', 'enabled': False}},
    {'path': '/api/flows/flow%2F%252F%2F%E6%9D%B1%E4%BA%AC/exports', 'method': 'PATCH', 'body': {'varKey': 'report/%2F', 'enabled': True}},
]
proof['cases'].append({'case': 'actual FlowExports switch Enter and Space execute exact synthetic PATCHes', 'requests': requests})
assert read(after, 'window.__buttonEvidence.failures') == []
read(after, 'window.scrollTo(0,0)')
proof['afterScreenshot'] = shot(after, s, 'hc038-after-native-actions.png')
cdp('Emulation.setDeviceMetricsOverride', session_id=s, width=390, height=844, deviceScaleFactor=1, mobile=True)
cdp('Emulation.setTouchEmulationEnabled', session_id=s, enabled=True)
read(after, 'window.scrollTo(0,0)')
width = read(after, '({viewport:innerWidth,document:document.documentElement.scrollWidth})')
assert width == {'viewport': 390, 'document': 390}, width
proof['cases'].append({'case': '390px viewport contains the actual controls without document overflow', **width})
proof['mobileScreenshot'] = shot(after, s, 'hc038-after-native-mobile.png')
proof['afterTarget'] = after
proof['failures'] = read(after, 'window.__buttonEvidence.failures')
proof['fixtureManifests'] = manifest_labels
with (out / proof_file).open('x') as result:
    result.write(json.dumps(proof, indent=2) + '\n')
print(json.dumps({'proof': proof_file, 'cases': len(proof['cases']), 'targets': [before, after], 'productionWrites': 0}))

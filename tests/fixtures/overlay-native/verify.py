"""Run through browser-harness, against the credential-free production fixture."""
import json
import os
import shutil
from pathlib import Path

out = Path(os.environ.get("MINION_OVERLAY_EVIDENCE", "/tmp/minion-overlay-evidence"))
out.mkdir(parents=True, exist_ok=True)
results = []

def read(expression):
    return json.loads(js("JSON.stringify(" + expression + ")"))

def settle():
    js("new Promise(resolve => setTimeout(() => resolve(true), 80))")

def click_selector(selector, last=False):
    query = "[...document.querySelectorAll(" + json.dumps(selector) + ")].at(-1)" if last else "document.querySelector(" + json.dumps(selector) + ")"
    rect = read("(() => { const r=" + query + ".getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()")
    click_at_xy(rect["x"], rect["y"])
    settle()

def key(name, code, modifiers=0):
    cdp("Input.dispatchKeyEvent", type="keyDown", key=name, code=name, windowsVirtualKeyCode=code, modifiers=modifiers)
    cdp("Input.dispatchKeyEvent", type="keyUp", key=name, code=name, windowsVirtualKeyCode=code, modifiers=modifiers)
    settle()

def capture(name):
    path = capture_screenshot()
    shutil.copy(path, out / (name + ".png"))

new_tab(os.environ.get("MINION_OVERLAY_FIXTURE_URL", "http://127.0.0.1:5294"))
wait_for_load()
cdp("Emulation.setDeviceMetricsOverride", width=1440, height=1000, deviceScaleFactor=1, mobile=False)
settle()
capture("fixture-desktop")
click_selector("#open-secret")
assert read("document.querySelector('dialog').matches(':modal')")
assert read("document.activeElement.type") == "password"
results.append("secret initial focus and native modal")

# A queued close event from an earlier opening must not close the new one.
js("window.__overlayFixture.reopen().then(() => true)")
settle()
assert read("document.querySelector('dialog').matches(':modal')")
assert read("document.querySelector('#fixture-state').dataset.closes") == "0"
results.append("rapid close/reopen retains new opening")

for _ in range(8):
    key("Tab", 9)
    # Native modal traversal can visit browser chrome (BODY active), but never
    # an inert background action in this document.
    assert read("document.activeElement.id") not in ["open-secret", "open-image", "background"]
key("Tab", 9, 1)
assert read("document.activeElement.id") not in ["open-secret", "open-image", "background"]
results.append("Tab and Shift-Tab do not reach inert background controls")

click_selector("dialog input")
cdp("Input.insertText", text="synthetic-fixture-secret")
click_selector("dialog button", last=True)
assert read("document.querySelector('#fixture-state').dataset.saves") == "1"
key("Escape", 27)
click_at_xy(2, 2)
click_selector("dialog button", last=True)
assert read("document.querySelector('dialog').matches(':modal')")
assert read("document.querySelector('#fixture-state').dataset.saves") == "1"
assert read("[...document.querySelectorAll('dialog button')].every(b => b.disabled)")
capture("secret-saving-desktop")
results.append("pending save resists Escape, backdrop and duplicate save")

js("window.__overlayFixture.fail(); true")
settle()
assert read("document.querySelector('[role=alert]').textContent") == "Fixture save failed"
click_selector("dialog button", last=True)
js("window.__overlayFixture.succeed(); true")
settle()
assert "Verified test response" in read("document.querySelector('dialog').textContent")
assert read("document.querySelector('#fixture-state').dataset.saves") == "2"
key("Escape", 27)
assert not read("document.querySelector('dialog').open")
assert read("document.activeElement.id") == "open-secret"
assert read("document.querySelector('#fixture-state').dataset.closes") == "1"
results.append("failed save retries; success remains visible; Escape returns focus once")

click_selector("#open-image")
assert read("document.querySelector('dialog:modal img').alt") == "Blue test rectangle"
capture("image-dialog-desktop")
cdp("Emulation.setDeviceMetricsOverride", width=390, height=844, deviceScaleFactor=1, mobile=True)
settle()
bounds = read("(() => { const r=document.querySelector('dialog:modal').getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,doc:document.documentElement.scrollWidth}; })()")
assert bounds["left"] >= 0 and bounds["right"] <= bounds["width"]
assert bounds["top"] >= 0 and bounds["bottom"] <= bounds["height"]
assert bounds["doc"] <= bounds["width"]
capture("image-dialog-mobile")
key("Escape", 27)
assert read("document.querySelector('dialog:modal') === null")
assert read("document.activeElement.id") == "open-image"
results.append("image modal fits 390px viewport and Escape returns focus")

(out / "results.json").write_text(json.dumps({"checks": results, "mobile": bounds}, indent=2) + "\n")
print(json.dumps({"passed": len(results), "evidence": str(out)}))

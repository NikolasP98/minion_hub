"""HC-029 native proof driver. Run through browser-harness (helpers pre-imported):

    BU_NAME=hc029 BU_CDP_URL=http://127.0.0.1:9224 browser-harness < scripts/qa/hc029/drive.py

(a private headless Chromium: `chromium --headless=new --remote-debugging-port=9224 --user-data-dir=<scratch>`;
the shared :9223 daemon is single-owner and other agents' tabs live there)

Env: HC029_URL (fixture index.html), HC029_OUT (evidence dir), HC029_LABEL (before|after).
Measures every visible target at 390x844 (pointer: coarse) and 1280x900 (fine), closed and
with the menu open, screenshots each, then drives a real keyboard sequence and records the
live focus state after every key. No login, no app shell, no production data.
"""
import json, os, time

URL = os.environ["HC029_URL"]
OUT = os.environ["HC029_OUT"]
LABEL = os.environ.get("HC029_LABEL", "run")
TRIGGER = '[aria-label="Show / hide ranges"]'


def emulate(w, h, coarse):
    cdp("Emulation.setDeviceMetricsOverride", width=w, height=h, deviceScaleFactor=1, mobile=coarse)
    cdp("Emulation.setEmulatedMedia", features=[
        {"name": "pointer", "value": "coarse" if coarse else "fine"},
        {"name": "hover", "value": "none" if coarse else "hover"},
    ])
    cdp("Emulation.setTouchEmulationEnabled", enabled=coarse)


def measure():
    return js("window.__hc029.measure()")


def focus_state():
    return js("window.__hc029.focusState()")


def key(k, **extra):
    base = {"key": k, "code": extra.get("code", k), "windowsVirtualKeyCode": extra.get("vk", 0),
            "nativeVirtualKeyCode": extra.get("vk", 0), "modifiers": extra.get("modifiers", 0)}
    # Enter/Space carry their text so Chromium also raises keypress → native button click.
    # The ContextMenu key only reaches Blink's contextmenu synthesis as a rawKeyDown (no char event).
    text = extra.get("text")
    cdp("Input.dispatchKeyEvent", type=extra.get("down", "keyDown"), **base, **({"text": text, "unmodifiedText": text} if text else {}))
    cdp("Input.dispatchKeyEvent", type="keyUp", **base)
    time.sleep(0.15)


KEYS = {
    "Enter": dict(vk=13, text="\r"), "Tab": dict(vk=9), "Escape": dict(vk=27), " ": dict(code="Space", vk=32, text=" "),
    "ArrowDown": dict(vk=40), "ArrowUp": dict(vk=38), "Home": dict(vk=36), "End": dict(vk=35),
    "ContextMenu": dict(vk=93, down="rawKeyDown"), "F10": dict(vk=121),
}

report = {"label": LABEL, "viewports": {}, "keyboard": []}

new_tab(URL)
wait_for_load()
activate_tab(current_tab())  # headless: only the foreground target paints/screenshots
js("document.fonts.ready")
time.sleep(0.5)

for name, (w, h, coarse) in {"mobile-390x844-coarse": (390, 844, True), "desktop-1280x900-fine": (1280, 900, False)}.items():
    emulate(w, h, coarse)
    js(f"window.__hc029.setTheme('new-york','blue'); document.activeElement && document.activeElement.blur()")
    time.sleep(0.4)
    closed = measure()
    capture_screenshot(os.path.join(OUT, f"{LABEL}-{name}-closed.png"))
    # open with a REAL pointer click on the ⋯ trigger
    r = js(f"(() => {{ const b = document.querySelector('{TRIGGER}').getBoundingClientRect(); return [b.x + b.width/2, b.y + b.height/2]; }})()")
    click_at_xy(r[0], r[1])
    time.sleep(0.5)
    opened = measure()
    capture_screenshot(os.path.join(OUT, f"{LABEL}-{name}-open.png"))
    report["viewports"][name] = {"closed": closed, "open": opened, "focusAfterClick": focus_state()}
    key("Escape", **KEYS["Escape"])
    time.sleep(0.3)

# Keyboard sequence at the mobile/coarse viewport (the a11y contract is viewport-independent).
emulate(390, 844, True)
seq = []


def step(label, fn):
    fn()
    time.sleep(0.25)
    seq.append({"step": label, **focus_state()})


step("focus trigger", lambda: js(f"document.querySelector('{TRIGGER}').focus()"))
step("Enter", lambda: key("Enter", **KEYS["Enter"]))
step("ArrowDown", lambda: key("ArrowDown", **KEYS["ArrowDown"]))
step("Space", lambda: key(" ", **KEYS[" "]))
capture_screenshot(os.path.join(OUT, f"{LABEL}-keyboard-after-space.png"))
step("End", lambda: key("End", **KEYS["End"]))
step("Home", lambda: key("Home", **KEYS["Home"]))
step("Escape", lambda: key("Escape", **KEYS["Escape"]))
step("Enter (reopen)", lambda: key("Enter", **KEYS["Enter"]))
step("Tab", lambda: key("Tab", **KEYS["Tab"]))
step("Escape (reset)", lambda: key("Escape", **KEYS["Escape"]))
step("focus 7d pill", lambda: js("[...document.querySelectorAll('button')].find(b => b.textContent.trim()==='7d').focus()"))
step("ContextMenu key", lambda: key("ContextMenu", **KEYS["ContextMenu"]))
step("Escape", lambda: key("Escape", **KEYS["Escape"]))
step("Shift+F10", lambda: key("F10", modifiers=8, **KEYS["F10"]))
step("Escape", lambda: key("Escape", **KEYS["Escape"]))
report["keyboard"] = seq

with open(os.path.join(OUT, f"{LABEL}-targets-and-keys.json"), "w") as f:
    json.dump(report, f, indent=2)
print(json.dumps(report["keyboard"], indent=1))
for name, v in report["viewports"].items():
    bad = [t for t in v["open"] if not t["ok"] and t["target"] != "__env"]
    print(name, "open targets:", len(v["open"]) - 1, "undersized:", len(bad))
    for t in bad:
        print("  ", t["target"], t["role"], f'{t["w"]}x{t["h"]}')
close_tab()

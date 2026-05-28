<div class="badge-clip">
    <div class="clip-base"></div>
    <div class="clip-ring"></div>
</div>

<style>
    .badge-clip {
        position: absolute;
        top: 0;
        left: 50%;
        transform: translateX(-50%);
        z-index: 10;
        display: flex;
        flex-direction: column;
        align-items: center;
    }

    .clip-base {
        width: 36px;
        height: 20px;
        background: linear-gradient(145deg, #3a3a3c, #1c1c1e);
        border-radius: 4px 4px 0 0;
        border: 1px solid #48484a;
        box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.1),
            0 2px 4px rgba(0, 0, 0, 0.4);
    }

    .clip-ring {
        width: 20px;
        height: 8px;
        background: linear-gradient(145deg, #48484a, #2c2c2e);
        border-radius: 0 0 10px 10px;
        border: 1px solid #5a5a5c;
        margin-top: -1px;
    }
</style>

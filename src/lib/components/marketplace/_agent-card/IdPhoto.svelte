<script lang="ts">
    interface Props {
        src: string;
        alt: string;
    }
    let { src, alt }: Props = $props();
</script>

<div class="photo-container">
    <div class="photo-frame">
        <img {src} {alt} class="agent-photo" loading="lazy" />
    </div>
    <div class="photo-corner tl"></div>
    <div class="photo-corner tr"></div>
    <div class="photo-corner bl"></div>
    <div class="photo-corner br"></div>
</div>

<style>
    .photo-container {
        display: flex;
        justify-content: center;
        margin: 16px 0;
        position: relative;
        z-index: 3;
    }

    .photo-frame {
        width: 90px;
        height: 90px;
        border-radius: 12px;
        background: #ffffff;
        padding: 4px;
        box-shadow:
            0 2px 8px rgba(0, 0, 0, 0.1),
            inset 0 0 0 1px rgba(0, 0, 0, 0.05);
        position: relative;
        overflow: hidden;
    }

    .agent-photo {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 8px;
        filter: contrast(1.05) saturate(0.9);
    }

    .photo-corner {
        position: absolute;
        width: 8px;
        height: 8px;
        border: 2px solid rgba(232, 84, 122, 0.4);
    }

    .photo-corner.tl {
        top: -4px;
        left: calc(50% - 45px - 4px);
        border-right: none;
        border-bottom: none;
    }
    .photo-corner.tr {
        top: -4px;
        right: calc(50% - 45px - 4px);
        border-left: none;
        border-bottom: none;
    }
    .photo-corner.bl {
        bottom: -4px;
        left: calc(50% - 45px - 4px);
        border-right: none;
        border-top: none;
    }
    .photo-corner.br {
        bottom: -4px;
        right: calc(50% - 45px - 4px);
        border-left: none;
        border-top: none;
    }

    @media (max-width: 640px) {
        .photo-frame {
            width: 80px;
            height: 80px;
        }
    }
</style>

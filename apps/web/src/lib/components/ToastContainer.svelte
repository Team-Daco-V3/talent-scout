<script lang="ts">
  import { onDestroy } from 'svelte';

  type ToastKind = 'success' | 'error' | 'info';

  interface ToastItem {
    id: string;
    kind: ToastKind;
    message: string;
    durationMs?: number;
  }

  export let toasts: ToastItem[] = [];
  export let onDismiss: (id: string) => void = () => {};

  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  $: {
    const visibleIds = new Set(toasts.map((toast) => toast.id));

    for (const [id, timer] of timers) {
      if (!visibleIds.has(id)) {
        clearTimeout(timer);
        timers.delete(id);
      }
    }

    for (const toast of toasts) {
      if (timers.has(toast.id)) continue;
      timers.set(
        toast.id,
        setTimeout(() => {
          timers.delete(toast.id);
          onDismiss(toast.id);
        }, toast.durationMs ?? (toast.kind === 'error' ? 5200 : 2600))
      );
    }
  }

  onDestroy(() => {
    for (const timer of timers.values()) {
      clearTimeout(timer);
    }
    timers.clear();
  });
</script>

{#if toasts.length}
  <section class="toast-region" aria-label="Notifications" aria-live="polite">
    {#each toasts as toast (toast.id)}
      <article class={`toast ${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
        <span class="toast-mark" aria-hidden="true">
          {toast.kind === 'success' ? 'OK' : toast.kind === 'error' ? '!' : 'i'}
        </span>
        <p>{toast.message}</p>
        <button type="button" aria-label="Dismiss notification" on:click={() => onDismiss(toast.id)}>
          X
        </button>
      </article>
    {/each}
  </section>
{/if}

<style>
  .toast-region {
    position: fixed;
    top: 76px;
    right: 24px;
    z-index: 60;
    display: grid;
    width: min(390px, calc(100vw - 28px));
    gap: 10px;
    pointer-events: none;
  }

  .toast {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 10px;
    align-items: start;
    min-height: 48px;
    border: 1px solid #d8e2ef;
    border-left-width: 4px;
    border-radius: 8px;
    background: #ffffff;
    box-shadow: 0 16px 42px rgba(15, 23, 42, 0.16);
    padding: 11px 12px;
    color: #172033;
    pointer-events: auto;
  }

  .toast.success {
    border-left-color: #0d9b62;
  }

  .toast.error {
    border-left-color: #c92c2c;
  }

  .toast.info {
    border-left-color: #255ee8;
  }

  .toast-mark {
    display: inline-grid;
    place-items: center;
    min-width: 24px;
    height: 24px;
    border-radius: 999px;
    background: #edf2f7;
    color: #334155;
    font-size: 11px;
    font-weight: 850;
    line-height: 1;
  }

  .toast.success .toast-mark {
    background: #e8fbf1;
    color: #0b6b43;
  }

  .toast.error .toast-mark {
    background: #fff1f1;
    color: #a52828;
  }

  .toast.info .toast-mark {
    background: #edf4ff;
    color: #174bbf;
  }

  .toast p {
    margin: 2px 0 0;
    color: #243244;
    font-size: 14px;
    font-weight: 720;
    line-height: 1.35;
  }

  .toast button {
    width: 26px;
    height: 26px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: #64748b;
    font-size: 12px;
    font-weight: 850;
  }

  .toast button:hover {
    background: #f1f5f9;
    color: #172033;
  }

  @media (max-width: 760px) {
    .toast-region {
      top: 12px;
      right: 14px;
      left: 14px;
      width: auto;
    }
  }
</style>

<script lang="ts">
  import { countryOptions, getCountryOption } from '$lib/geo/countries';

  export let selected: string[] = [];
  export let label = 'Countries';
  export let placeholder = 'Search countries by name or code';
  export let help = 'Choose where candidates should be based. Search by country name or ISO code.';
  export let required = false;
  export let disabled = false;
  export let onSelectedChange: (selected: string[]) => void = () => {};

  const listboxId = 'country-select-options';

  let container: HTMLDivElement | undefined;
  let searchInput: HTMLInputElement | undefined;
  let query = '';
  let open = false;
  let activeIndex = 0;
  let menuStyle = '';

  $: selectedCodes = selected.map((code) => code.trim().toUpperCase()).filter(Boolean);
  $: selectedCountries = selectedCodes
    .map((code) => getCountryOption(code) ?? { code, name: code })
    .filter((country, index, countries) => countries.findIndex((item) => item.code === country.code) === index);
  $: normalizedQuery = query.trim().toLowerCase();
  $: queryTokens = normalizedQuery.split(/[,\s]+/).filter(Boolean);
  $: collapsed = selectedCountries.length > 1 && !open && !query;
  $: visibleSelectedCountries = collapsed ? selectedCountries.slice(0, 1) : selectedCountries;
  $: extraSelectedCount = collapsed ? selectedCountries.length - 1 : 0;
  $: filteredCountries = countryOptions
    .filter((country) => !selectedCodes.includes(country.code))
    .map((country) => ({ country, rank: countrySearchRank(country, queryTokens) }))
    .filter((item) => item.rank !== null)
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || a.country.name.localeCompare(b.country.name))
    .map((item) => item.country)
    .slice(0, 12);

  function countrySearchRank(country: (typeof countryOptions)[number], tokens: string[]): number | null {
    if (!tokens.length) return 10;
    const code = country.code.toLowerCase();
    const name = country.name.toLowerCase();
    const aliases = (country.aliases ?? []).map((alias) => alias.toLowerCase());
    let best: number | null = null;

    for (const token of tokens) {
      let rank: number | null = null;
      if (code === token) rank = 0;
      else if (aliases.some((alias) => alias === token)) rank = 1;
      else if (code.startsWith(token)) rank = 2;
      else if (name.startsWith(token)) rank = 3;
      else if (aliases.some((alias) => alias.startsWith(token))) rank = 4;
      else if (name.includes(token) || aliases.some((alias) => alias.includes(token))) rank = 5;
      if (rank !== null) best = best === null ? rank : Math.min(best, rank);
    }

    return best;
  }

  function focusSearch() {
    if (disabled) return;
    open = true;
    updateMenuPosition();
    searchInput?.focus();
  }

  function setSelected(nextSelected: string[]) {
    if (disabled) return;
    selected = nextSelected;
    onSelectedChange(selected);
  }

  function updateMenuPosition() {
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const gap = 6;
    const viewportPadding = 10;
    const preferredHeight = 260;
    const belowSpace = window.innerHeight - rect.bottom - viewportPadding;
    const aboveSpace = rect.top - viewportPadding;
    const openAbove = belowSpace < 220 && aboveSpace > belowSpace;
    const maxHeight = Math.max(
      150,
      Math.min(preferredHeight, (openAbove ? aboveSpace : belowSpace) - gap)
    );
    const top = openAbove ? rect.top - maxHeight - gap : rect.bottom + gap;
    const left = Math.max(viewportPadding, rect.left);
    const width = Math.max(240, Math.min(rect.width, window.innerWidth - left - viewportPadding));

    menuStyle = [
      `left: ${left}px`,
      `top: ${Math.max(viewportPadding, top)}px`,
      `width: ${width}px`,
      `max-height: ${maxHeight}px`
    ].join(';');
  }

  function addMatchingQueryCountries(): boolean {
    if (!queryTokens.length) return false;
    const exactMatches = countryOptions
      .filter((country) => !selectedCodes.includes(country.code))
      .filter((country) => queryTokens.includes(country.code.toLowerCase()));
    if (!exactMatches.length) return false;
    setSelected([...selectedCodes, ...exactMatches.map((country) => country.code)]);
    query = '';
    activeIndex = 0;
    return true;
  }

  function handleInput() {
    if (disabled) return;
    open = true;
    updateMenuPosition();
    activeIndex = 0;
    if (!/[,\s]$/.test(query)) return;
    addMatchingQueryCountries();
  }

  function handlePaste(event: ClipboardEvent) {
    if (disabled) return;
    const text = event.clipboardData?.getData('text') ?? '';
    const pastedCodes = text
      .split(/[,\s]+/)
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean);
    const matchedCodes = pastedCodes.filter((code) => getCountryOption(code) && !selectedCodes.includes(code));
    if (matchedCodes.length <= 1) return;
    event.preventDefault();
    setSelected([...selectedCodes, ...matchedCodes]);
    query = '';
    activeIndex = 0;
    open = true;
    updateMenuPosition();
  }

  function selectCountry(code: string) {
    if (disabled) return;
    const normalized = code.trim().toUpperCase();
    if (!normalized || selectedCodes.includes(normalized)) return;
    setSelected([...selectedCodes, normalized]);
    query = '';
    activeIndex = 0;
    open = true;
    updateMenuPosition();
    searchInput?.focus();
  }

  function removeCountry(code: string) {
    if (disabled) return;
    setSelected(selectedCodes.filter((item) => item !== code));
    searchInput?.focus();
  }

  function clearCountries() {
    if (disabled) return;
    setSelected([]);
    query = '';
    activeIndex = 0;
    searchInput?.focus();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (disabled) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      open = true;
      updateMenuPosition();
      activeIndex = Math.min(activeIndex + 1, Math.max(0, filteredCountries.length - 1));
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (addMatchingQueryCountries()) return;
      const option = filteredCountries[activeIndex];
      if (option) selectCountry(option.code);
    }

    if (event.key === 'Backspace' && !query && selectedCodes.length) {
      removeCountry(selectedCodes[selectedCodes.length - 1]);
    }

    if (event.key === 'Escape') {
      open = false;
    }
  }

  function handleWindowClick(event: MouseEvent) {
    if (!open || !container || !(event.target instanceof Node)) return;
    if (!container.contains(event.target)) open = false;
  }
</script>

<svelte:window on:click={handleWindowClick} on:resize={updateMenuPosition} on:scroll={updateMenuPosition} />

<div class="country-select" bind:this={container}>
  <div class="label-row">
    <span>{label}</span>
    <em class:required>{required ? 'Required' : 'Optional'}</em>
    {#if selectedCountries.length}
      <button class="clear-btn" type="button" disabled={disabled} on:click={clearCountries}>Clear</button>
    {/if}
  </div>

  {#if help}
    <small class="field-help">{help}</small>
  {/if}

  <div
    class:open
    class:compact={collapsed}
    class:disabled
    class="select-box"
  >
    {#each visibleSelectedCountries as country}
      <button class="chip" type="button" disabled={disabled} on:click|stopPropagation={() => removeCountry(country.code)}>
        <strong>{country.code}</strong>
        <span>{country.name}</span>
      </button>
    {/each}

    {#if extraSelectedCount}
      <button class="chip summary-chip" type="button" disabled={disabled} on:click|stopPropagation={focusSearch}>
        +{extraSelectedCount}
      </button>
    {/if}

    <input
      bind:this={searchInput}
      bind:value={query}
      placeholder={selectedCountries.length ? 'Add country' : placeholder}
      aria-label={label}
      role="combobox"
      aria-expanded={open}
      aria-controls={listboxId}
      aria-autocomplete="list"
      aria-activedescendant={open && filteredCountries[activeIndex]
        ? `country-option-${filteredCountries[activeIndex].code}`
        : undefined}
      disabled={disabled}
      on:focus={focusSearch}
      on:input={handleInput}
      on:keydown={handleKeydown}
      on:paste={handlePaste}
    />
  </div>

  {#if open && !disabled}
    <div class="option-menu" id={listboxId} role="listbox" style={menuStyle}>
      {#if filteredCountries.length}
        {#each filteredCountries as country, index}
          <button
            id={`country-option-${country.code}`}
            class:active={index === activeIndex}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            on:mousedown|preventDefault={() => selectCountry(country.code)}
          >
            <span>{country.name}</span>
            <strong>{country.code}</strong>
          </button>
        {/each}
      {:else}
        <div class="no-results">No country found</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .country-select {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 0;
  }

  .label-row {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 10px;
  }

  .label-row span {
    color: #475569;
    font-size: 0.78rem;
    font-weight: 750;
  }

  .label-row em {
    padding: 2px 7px;
    border-radius: 999px;
    color: #64748b;
    background: #f1f5f9;
    font-size: 0.66rem;
    font-style: normal;
    font-weight: 800;
    text-transform: uppercase;
  }

  .label-row em.required {
    color: #075985;
    background: #e0f2fe;
  }

  .field-help {
    color: #64748b;
    font-size: 0.76rem;
    line-height: 1.4;
  }

  .clear-btn {
    margin-left: auto;
    min-height: 0;
    padding: 0;
    color: #64748b;
    background: transparent;
    border: 0;
    font-size: 0.74rem;
    font-weight: 750;
  }

  .clear-btn:hover {
    color: #0f766e;
  }

  .select-box {
    display: flex;
    min-height: 39px;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 5px 8px;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    background: #ffffff;
    cursor: text;
  }

  .select-box.open,
  .select-box:focus-within {
    border-color: #0f766e;
    box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.12);
  }

  .select-box.disabled {
    opacity: 0.62;
    cursor: not-allowed;
  }

  .chip {
    display: inline-flex;
    min-height: 26px;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    border: 0;
    border-radius: 999px;
    color: #0f766e;
    background: #ccfbf1;
    font-size: 0.75rem;
    font-weight: 750;
  }

  .chip strong {
    color: #134e4a;
    font-size: 0.68rem;
  }

  .select-box.compact .chip:not(.summary-chip) span {
    display: none;
  }

  .summary-chip {
    color: #334155;
    background: #e2e8f0;
  }

  input {
    min-width: 150px;
    flex: 1;
    height: 27px;
    padding: 0 2px;
    border: 0;
    outline: none;
    color: #172033;
    background: transparent;
  }

  input::placeholder {
    color: #94a3b8;
  }

  .option-menu {
    position: fixed;
    z-index: 1000;
    display: grid;
    overflow-y: auto;
    padding: 6px;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    background: #ffffff;
    box-shadow: 0 16px 40px rgba(15, 23, 42, 0.13);
  }

  .option-menu button {
    display: flex;
    min-height: 36px;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 9px;
    border: 0;
    border-radius: 7px;
    color: #243244;
    background: transparent;
    font-size: 0.82rem;
    text-align: left;
  }

  .option-menu button:hover,
  .option-menu button.active {
    background: #f1f5f9;
  }

  .option-menu strong {
    color: #64748b;
    font-size: 0.72rem;
  }

  .no-results {
    padding: 10px;
    color: #64748b;
    font-size: 0.82rem;
  }
</style>

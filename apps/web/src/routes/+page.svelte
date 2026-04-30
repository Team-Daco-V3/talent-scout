<script lang="ts">
  import { onMount } from 'svelte';

  import CountryMultiSelect from '$lib/components/CountryMultiSelect.svelte';
  import ToastContainer from '$lib/components/ToastContainer.svelte';
  import { getAiProviderPreset, type AiProviderId } from '$lib/ai/providers';
  import { downloadResultsCsv, downloadResultsJson, downloadText } from '$lib/export/results';
  import { workModeOptions, type WorkMode } from '$lib/fit/options';
  import {
    mergeReportCandidates,
    reportsToSavedReportFile,
    sortReports
  } from '$lib/reports/state';
  import type {
    CandidateProfile,
    CandidateSearchAttempt,
    EvaluatedCandidate,
    FitRunResult,
    HiringWorkflow,
    LinkInsight
  } from '$lib/fit/types';
  import type { ScoutReport, ScoutReportConfig, ScoutReportSummary } from '$lib/reports/types';
  import {
    buildScoutRequest,
    createScout,
    deleteScout,
    duplicateScout,
    mergedCandidatesToResult,
    migrateLegacyScout,
    queueScoutRuns,
    resetScoutRun,
    startableScoutIds,
    sortCandidateRows
  } from '$lib/scouts/state';
  import type { CandidateRow, MergedCandidate, ScoutCredentials, ScoutState } from '$lib/scouts/types';

  type WorkspaceTab = 'setup' | 'scouts' | 'reports';
  type ReportTab = 'all' | string;
  type ToastKind = 'success' | 'error' | 'info';
  type ScoreRange = { min: number; max: number };
  type ReportCandidate = CandidateRow | EvaluatedCandidate;
  type ReportViewKind = 'live' | 'saved';

  interface ToastItem {
    id: string;
    kind: ToastKind;
    message: string;
    durationMs?: number;
  }

  type FindStreamEvent =
    | { type: 'phase'; message: string }
    | { type: 'started'; generatedAt: string }
    | { type: 'attempts'; searchAttempts: CandidateSearchAttempt[] }
    | { type: 'attempt_updated'; attempt: CandidateSearchAttempt; totals: { discovered: number } }
    | { type: 'candidate_found'; candidate: CandidateProfile; totals: { discovered: number } }
    | { type: 'candidate_evaluating'; userId: string; totals: { discovered: number; evaluated: number } }
    | { type: 'candidate_evaluated'; candidate: EvaluatedCandidate; totals: { discovered: number; evaluated: number } }
    | { type: 'warning'; message: string }
    | { type: 'done'; result: FitRunResult }
    | { type: 'error'; message: string };

  interface PersistedWorkspace {
    markidyApiUrl?: string;
    markidyApiKey?: string;
    aiProvider?: string;
    aiApiKey?: string;
    aiBaseUrl?: string;
    aiModel?: string;
    selectedScoutId?: string;
    reportTab?: string;
    activeWorkspaceTab?: WorkspaceTab;
    suppressedReportRunKeys?: string[];
    scouts?: ScoutState[];
  }

  interface ReportView {
    id: string;
    kind: ReportViewKind;
    scoutId: string;
    scoutName: string;
    generatedAt: string;
    status: ScoutState['status'] | ScoutReport['status'];
    phase: string;
    targetCandidates: number;
    candidates: ReportCandidate[];
    searchAttempts: CandidateSearchAttempt[];
    totals: FitRunResult['totals'];
    warnings: string[];
    savedReport?: ScoutReport;
  }

  interface ReportCandidateRow {
    key: string;
    scoutName: string;
    candidate: ReportCandidate;
  }

  const workspaceStorageKey = 'markidy-fit-multi-scout-v1';
  const legacyWorkflowStorageKey = 'markidy-fit-workflow-v1';
  const maxConcurrentScouts = 2;
  const fallbackMarkidyApiUrl = 'https://api.markidy.com';
  const fallbackAiProvider: AiProviderId = 'openai';
  const fallbackAiBaseUrl = 'https://api.openai.com/v1';
  const fallbackAiModel = 'gpt-4o-mini';

  const abortControllers = new Map<string, AbortController>();

  let activeWorkspaceTab: WorkspaceTab = 'setup';
  let reportTab: ReportTab = 'all';
  let selectedScoutId = 'scout-1';
  let scouts: ScoutState[] = [createScout('scout-1', 1)];
  let savedReports: ScoutReport[] = [];
  let reportsLoading = false;
  let reportsLoaded = false;
  let suppressedReportRunKeys: string[] = [];
  let pendingReportSaveRunKeys: string[] = [];
  let failedReportSaveRunKeys: string[] = [];
  let reportMinScore = 0;
  let reportMaxScore = 100;

  let markidyApiUrl = fallbackMarkidyApiUrl;
  let markidyApiKey = '';
  let aiProvider: AiProviderId = fallbackAiProvider;
  let aiApiKey = '';
  let aiBaseUrl = fallbackAiBaseUrl;
  let aiModel = fallbackAiModel;

  let toasts: ToastItem[] = [];

  $: selectedAiProvider = getAiProviderPreset(aiProvider);
  $: selectedScout = scouts.find((scout) => scout.id === selectedScoutId) ?? scouts[0];
  $: selectedScoutLocked = selectedScout ? isScoutLocked(selectedScout) : false;
  $: liveReportViews = buildLiveReportViews(scouts, savedReports);
  $: savedReportViews = savedReports.map(savedReportView);
  $: reportViews = [...liveReportViews, ...savedReportViews];
  $: reportMergedCandidates = mergeReportCandidates([...liveReportViews.map(reportViewToScoutReport), ...savedReports]);
  $: allPendingReportRows = liveReportViews.flatMap((report) => reportPendingRows(report));
  $: selectedReportView = reportTab === 'all' ? null : reportViews.find((report) => report.id === reportTab) ?? null;
  $: selectedSavedReport = selectedReportView?.kind === 'saved' ? selectedReportView.savedReport ?? null : null;
  $: reportScoreRange = normalizeReportScoreRange(reportMinScore, reportMaxScore);
  $: filteredMergedCandidates = filterMergedCandidatesByScore(reportMergedCandidates, reportScoreRange);
  $: filteredAllPendingRows = filterReportRowsByScore(allPendingReportRows, reportScoreRange);
  $: filteredReportCandidates = selectedReportView
    ? filterReportCandidatesByScore(selectedReportView.candidates, reportScoreRange)
    : [];
  $: filteredSelectedReportResult =
    reportTab === 'all'
      ? mergedCandidatesToResult(filteredMergedCandidates)
      : selectedReportView
        ? reportViewToResult(selectedReportView, filteredReportCandidates)
        : null;
  $: activeReportTotal = reportTab === 'all'
    ? reportMergedCandidates.length + allPendingReportRows.length
    : selectedReportView
      ? selectedReportView.candidates.length
      : 0;
  $: activeReportVisibleCount = reportTab === 'all'
    ? filteredMergedCandidates.length + filteredAllPendingRows.length
    : filteredReportCandidates.length;
  $: hasCredentials = Boolean(markidyApiKey.trim() && aiApiKey.trim());
  $: runningCount = scouts.filter((scout) => scout.status === 'running').length;
  $: queuedCount = scouts.filter((scout) => scout.status === 'queued').length;
  $: canRunAll = hasCredentials && scouts.some((scout) => canQueueScout(scout));
  $: if (reportsLoaded && reportTab !== 'all' && !reportViews.some((report) => report.id === reportTab)) {
    reportTab = 'all';
  }

  onMount(() => {
    loadWorkspace();
    void loadSavedReports();
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasActiveScoutRun()) return;
      event.preventDefault();
      event.returnValue = 'Scouting is still running. Refreshing or leaving this page will stop the current run.';
      return event.returnValue;
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  });

  function normalizeAiProvider(value: unknown): AiProviderId {
    const preset = getAiProviderPreset(String(value ?? fallbackAiProvider));
    return preset.id;
  }

  function newScoutId() {
    return `scout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function currentCredentials(): ScoutCredentials {
    return {
      markidyApiUrl,
      markidyApiKey,
      aiProvider,
      aiApiKey,
      aiBaseUrl,
      aiModel
    };
  }

  function persistWorkspace(message?: string) {
    if (typeof sessionStorage === 'undefined') return;

    const payload: PersistedWorkspace = {
      markidyApiUrl,
      markidyApiKey,
      aiProvider,
      aiApiKey,
      aiBaseUrl,
      aiModel,
      selectedScoutId,
      reportTab,
      activeWorkspaceTab,
      suppressedReportRunKeys,
      scouts
    };

    try {
      sessionStorage.setItem(workspaceStorageKey, JSON.stringify(payload));
      if (message) {
        showToast(message, 'success');
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to save workspace.', 'error');
    }
  }

  function showToast(message: string, kind: ToastKind = 'info', durationMs?: number) {
    toasts = [
      ...toasts,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind,
        message,
        durationMs
      }
    ].slice(-4);
  }

  function dismissToast(id: string) {
    toasts = toasts.filter((toast) => toast.id !== id);
  }

  function reportUrl(id: string) {
    return `/api/reports/${encodeURIComponent(id)}`;
  }

  async function loadSavedReports() {
    reportsLoading = true;
    try {
      const listResponse = await fetch('/api/reports');
      if (!listResponse.ok) {
        const payload = await listResponse.json().catch(() => ({}));
        throw new Error(payload.error || 'Failed to load saved reports.');
      }

      const listPayload = (await listResponse.json()) as {
        reports?: ScoutReportSummary[];
        warnings?: string[];
      };
      const loadedReports = await Promise.all(
        (listPayload.reports || []).map(async (summary) => {
          const detailResponse = await fetch(reportUrl(summary.id));
          if (!detailResponse.ok) return null;
          const detailPayload = (await detailResponse.json()) as { report?: ScoutReport };
          return detailPayload.report ?? null;
        })
      );

      savedReports = sortReports(loadedReports.filter((report): report is ScoutReport => Boolean(report)));
      if (listPayload.warnings?.length) {
        showToast(`${listPayload.warnings.length} report file could not be loaded.`, 'info');
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to load saved reports.', 'error');
    } finally {
      reportsLoading = false;
      reportsLoaded = true;
    }
  }

  function loadWorkspace() {
    if (typeof sessionStorage === 'undefined') return;

    const stored = sessionStorage.getItem(workspaceStorageKey);

    if (stored) {
      try {
        const parsed = JSON.parse(stored) as PersistedWorkspace;
        markidyApiUrl = parsed.markidyApiUrl || fallbackMarkidyApiUrl;
        markidyApiKey = parsed.markidyApiKey || '';
        aiProvider = normalizeAiProvider(parsed.aiProvider);
        aiApiKey = parsed.aiApiKey || '';
        aiBaseUrl = parsed.aiBaseUrl || getAiProviderPreset(aiProvider).defaultBaseUrl || fallbackAiBaseUrl;
        aiModel = parsed.aiModel || getAiProviderPreset(aiProvider).defaultModel || fallbackAiModel;
        activeWorkspaceTab =
          parsed.activeWorkspaceTab === 'reports' || parsed.activeWorkspaceTab === 'scouts'
            ? parsed.activeWorkspaceTab
            : 'setup';
        reportTab = parsed.reportTab || 'all';
        suppressedReportRunKeys = Array.isArray(parsed.suppressedReportRunKeys)
          ? parsed.suppressedReportRunKeys.map((key) => String(key)).filter(Boolean)
          : [];

        const restoredScouts = Array.isArray(parsed.scouts)
          ? parsed.scouts.map((scout, index) => {
              const restored = createScout(scout.id || newScoutId(), index + 1, scout);
              if (restored.status === 'running' || restored.status === 'queued') {
                return {
                  ...restored,
                  status: 'stopped' as const,
                  phase: 'Stopped after browser reload.'
                };
              }
              return restored;
            })
          : [];

        scouts = restoredScouts.length ? restoredScouts : [createScout('scout-1', 1)];
        selectedScoutId = parsed.selectedScoutId && scouts.some((scout) => scout.id === parsed.selectedScoutId)
          ? parsed.selectedScoutId
          : scouts[0].id;
        return;
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Failed to restore workspace.', 'error');
      }
    }

    const legacyStored = sessionStorage.getItem(legacyWorkflowStorageKey);
    if (!legacyStored) return;

    try {
      const legacy = JSON.parse(legacyStored) as Partial<HiringWorkflow> & PersistedWorkspace;
      markidyApiUrl = legacy.markidyApiUrl || fallbackMarkidyApiUrl;
      markidyApiKey = legacy.markidyApiKey || '';
      aiProvider = normalizeAiProvider(legacy.aiProvider);
      aiApiKey = legacy.aiApiKey || '';
      aiBaseUrl = legacy.aiBaseUrl || getAiProviderPreset(aiProvider).defaultBaseUrl || fallbackAiBaseUrl;
      aiModel = legacy.aiModel || getAiProviderPreset(aiProvider).defaultModel || fallbackAiModel;

      const migrated = migrateLegacyScout('scout-1', legacy as Partial<HiringWorkflow>);
      scouts = [migrated ?? createScout('scout-1', 1)];
      selectedScoutId = scouts[0].id;
      showToast('Previous single-scout setup was migrated.', 'success');
      persistWorkspace();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to migrate previous setup.', 'error');
    }
  }

  function patchScouts(nextScouts: ScoutState[], message?: string) {
    scouts = nextScouts;
    persistWorkspace(message);
  }

  function patchScout(scoutId: string, patch: Partial<ScoutState>, message?: string) {
    patchScouts(
      scouts.map((scout) => (scout.id === scoutId ? { ...scout, ...patch } : scout)),
      message
    );
  }

  function patchScoutConfig(scoutId: string, patch: Partial<ScoutState>) {
    patchScouts(
      scouts.map((scout) => {
        if (scout.id !== scoutId) return scout;
        const next = { ...scout, ...patch };
        const shouldReset = Object.keys(patch).some((key) => key !== 'name');
        return shouldReset ? resetScoutRun(next) : next;
      })
    );
  }

  function saveCurrentStep(message = 'Workspace saved.') {
    persistWorkspace(message);
  }

  function createNewScout() {
    const scout = createScout(newScoutId(), scouts.length + 1);
    patchScouts([...scouts, scout], 'New scout created.');
    selectedScoutId = scout.id;
    activeWorkspaceTab = 'scouts';
  }

  function duplicateSelectedScout() {
    if (!selectedScout) return;
    const duplicated = duplicateScout(selectedScout, newScoutId(), scouts.map((scout) => scout.name));
    patchScouts([...scouts, duplicated], 'Scout copied.');
    selectedScoutId = duplicated.id;
    activeWorkspaceTab = 'scouts';
  }

  function removeSelectedScout() {
    if (!selectedScout || scouts.length <= 1 || selectedScout.status === 'running') return;
    abortControllers.get(selectedScout.id)?.abort();
    abortControllers.delete(selectedScout.id);
    const next = deleteScout(scouts, selectedScout.id);
    selectedScoutId = next[0].id;
    reportTab = reportTab === selectedScout.id ? 'all' : reportTab;
    patchScouts(next, 'Scout deleted.');
  }

  function onProviderChange(event: Event) {
    const nextProvider = normalizeAiProvider((event.currentTarget as HTMLSelectElement).value);
    aiProvider = nextProvider;
    const preset = getAiProviderPreset(nextProvider);
    aiBaseUrl = preset.defaultBaseUrl;
    aiModel = preset.defaultModel;
    persistWorkspace();
  }

  function onGlobalInput() {
    persistWorkspace();
  }

  function isScoutLocked(scout: ScoutState) {
    return scout.status === 'running' || scout.status === 'queued';
  }

  function canQueueScout(scout: ScoutState) {
    return Boolean(scout.roleSummary.trim()) && scout.status !== 'running' && scout.status !== 'queued';
  }

  function hasActiveScoutRun() {
    return scouts.some((scout) => scout.status === 'running' || scout.status === 'queued');
  }

  function toggleScoutWorkMode(scout: ScoutState, mode: WorkMode) {
    if (isScoutLocked(scout)) return;
    const workModes = scout.workModes.includes(mode)
      ? scout.workModes.filter((item) => item !== mode)
      : [...scout.workModes, mode];
    patchScoutConfig(scout.id, { workModes });
  }

  function activeSearchFilters(scout: ScoutState) {
    const filters = [];
    if (scout.skills.trim()) filters.push('skills');
    if (scout.countries.length) filters.push('countries');
    if (scout.workModes.length) filters.push('work modes');
    if (scout.locations.trim()) filters.push('locations');
    if (scout.minExperienceYears > 0) filters.push('experience');
    return filters.length ? filters.join(', ') : 'role summary only';
  }

  function bestScoutScore(scout: ScoutState) {
    const scores = scout.candidateRows
      .map((candidate) => candidate.evaluation?.fitScore)
      .filter((score): score is number => typeof score === 'number');
    return scores.length ? Math.max(...scores) : null;
  }

  function linkHost(value: string) {
    try {
      return new URL(value).hostname.replace(/^www\./, '');
    } catch {
      return value;
    }
  }

  function humanizeLinkLabel(value?: string) {
    const label = String(value || '').trim();
    if (!label || /^(url|href|link|links)$/i.test(label)) return '';
    const normalized = label
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const knownLabels: Record<string, string> = {
      github: 'GitHub',
      linkedin: 'LinkedIn',
      portfolio: 'Portfolio',
      website: 'Website',
      homepage: 'Website',
      blog: 'Blog',
      twitter: 'X / Twitter',
      x: 'X',
      socials: 'Social profile',
      sociallinks: 'Social profile',
      trustlinks: 'Trust link'
    };
    return knownLabels[normalized] || normalized.replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function linkSourceLabel(fieldPath?: string) {
    const path = String(fieldPath || '').toLowerCase();
    if (!path) return '';
    if (path.includes('github')) return 'GitHub';
    if (path.includes('linkedin')) return 'LinkedIn';
    if (path.includes('portfolio')) return 'Portfolio';
    if (path.includes('website') || path.includes('homepage')) return 'Website';
    if (path.includes('blog')) return 'Blog';
    if (path.includes('twitter')) return 'X / Twitter';
    if (path.includes('trustlinks')) return 'Trust link';
    if (path.includes('social')) return 'Social profile';
    if (path.includes('project') || path.includes('career')) return 'Project';
    return '';
  }

  function linkDisplayTitle(link: LinkInsight) {
    return link.title?.trim() || humanizeLinkLabel(link.label) || linkSourceLabel(link.fieldPath) || linkHost(link.url);
  }

  function linkDisplayMeta(link: LinkInsight) {
    const host = linkHost(link.url);
    const source = linkSourceLabel(link.fieldPath) || humanizeLinkLabel(link.label);
    return source && source !== linkDisplayTitle(link) ? `${host} · ${source}` : host;
  }

  function reportRunKey(scoutId: string, generatedAt: string) {
    return `${scoutId}:${generatedAt}`;
  }

  function hasSavedReportForScoutRun(scout: ScoutState, reports: ScoutReport[]) {
    if (!scout.generatedAt) return false;
    return reports.some((report) => report.scoutId === scout.id && report.generatedAt === scout.generatedAt);
  }

  function isSuppressedScoutRun(scout: ScoutState) {
    return Boolean(scout.generatedAt && suppressedReportRunKeys.includes(reportRunKey(scout.id, scout.generatedAt)));
  }

  function hasTransientReportSaveState(scout: ScoutState) {
    if (!scout.generatedAt) return false;
    const key = reportRunKey(scout.id, scout.generatedAt);
    return pendingReportSaveRunKeys.includes(key) || failedReportSaveRunKeys.includes(key);
  }

  function hasLiveReportActivity(scout: ScoutState, reports: ScoutReport[]) {
    const hasRunData = scout.candidateRows.length > 0 || scout.searchAttempts.length > 0;
    if (scout.status === 'running' || scout.status === 'queued') return true;
    if (scout.status === 'failed' || scout.status === 'stopped') return hasRunData;
    if (scout.status === 'done') {
      return hasRunData && !hasSavedReportForScoutRun(scout, reports) && !isSuppressedScoutRun(scout) && hasTransientReportSaveState(scout);
    }
    return false;
  }

  function buildLiveReportViews(inputScouts: ScoutState[], reports: ScoutReport[]) {
    return inputScouts.filter((scout) => hasLiveReportActivity(scout, reports)).map(liveScoutReportView);
  }

  function savedReportView(report: ScoutReport): ReportView {
    return {
      id: report.id,
      kind: 'saved',
      scoutId: report.scoutId,
      scoutName: report.scoutName,
      generatedAt: report.generatedAt,
      status: report.status,
      phase: 'Saved report.',
      targetCandidates: report.scoutConfig.maxCandidates || report.result.totals.discovered || report.result.candidates.length,
      candidates: report.result.candidates,
      searchAttempts: report.result.searchAttempts,
      totals: report.result.totals,
      warnings: report.result.warnings,
      savedReport: report
    };
  }

  function liveScoutReportView(scout: ScoutState): ReportView {
    return {
      id: `live:${scout.id}`,
      kind: 'live',
      scoutId: scout.id,
      scoutName: scout.name,
      generatedAt: scout.generatedAt || new Date().toISOString(),
      status: scout.status,
      phase: scout.phase || 'Waiting to run.',
      targetCandidates: Number(scout.maxCandidates) || scout.totals.discovered || scout.candidateRows.length,
      candidates: visibleCandidateRows(scout),
      searchAttempts: scout.searchAttempts,
      totals: scout.totals,
      warnings: scout.warnings
    };
  }

  function evaluatedCandidate(candidate: ReportCandidate): EvaluatedCandidate | null {
    if (!candidate.evaluation) return null;
    if ('evaluationStatus' in candidate) {
      const { evaluationStatus, order, ...profile } = candidate;
      return { ...profile, evaluation: candidate.evaluation } as EvaluatedCandidate;
    }
    return candidate;
  }

  function evaluatedCandidates(candidates: ReportCandidate[]) {
    return candidates.flatMap((candidate) => {
      const evaluated = evaluatedCandidate(candidate);
      return evaluated ? [evaluated] : [];
    });
  }

  function reportViewToResult(report: ReportView, candidates: ReportCandidate[]): FitRunResult {
    const evaluated = evaluatedCandidates(candidates);
    return {
      generatedAt: report.generatedAt,
      candidates: evaluated,
      searchAttempts: report.searchAttempts,
      totals: {
        discovered: report.totals.discovered,
        evaluated: evaluated.length,
        searchAttempts: report.searchAttempts.length
      },
      warnings: report.warnings
    };
  }

  function reportViewToScoutReport(report: ReportView): ScoutReport {
    return {
      id: report.id,
      scoutId: report.scoutId,
      scoutName: report.scoutName,
      scoutConfig: {
        roleSummary: '',
        idealCandidate: '',
        minExperienceYears: 0,
        skills: '',
        countries: [],
        workModes: [],
        locations: '',
        maxCandidates: report.targetCandidates,
        searchAttemptsLimit: report.searchAttempts.length || 6
      },
      createdAt: report.generatedAt,
      generatedAt: report.generatedAt,
      status: 'done',
      result: reportViewToResult(report, report.candidates)
    };
  }

  function reportPendingRows(report: ReportView): ReportCandidateRow[] {
    return report.candidates
      .filter((candidate) => !candidate.evaluation)
      .map((candidate) => ({
        key: `${report.id}:${candidate.userId}`,
        scoutName: report.scoutName,
        candidate
      }));
  }

  function reportProgressPercent(report: ReportView) {
    if (report.kind === 'saved') return 100;
    if (report.status === 'queued') return 0;
    const target = Math.max(1, report.targetCandidates, report.totals.discovered, report.totals.evaluated);
    return Math.max(0, Math.min(100, Math.round((report.totals.evaluated / target) * 100)));
  }

  function scoutConfigSnapshot(scout: ScoutState): ScoutReportConfig {
    return {
      roleSummary: scout.roleSummary,
      idealCandidate: scout.idealCandidate,
      minExperienceYears: scout.minExperienceYears,
      skills: scout.skills,
      countries: scout.countries,
      workModes: scout.workModes,
      locations: scout.locations,
      maxCandidates: scout.maxCandidates,
      searchAttemptsLimit: scout.searchAttemptsLimit
    };
  }

  async function saveCompletedScoutReport(scoutId: string, result: FitRunResult) {
    const scout = scouts.find((item) => item.id === scoutId);
    if (!scout) return;
    const runKey = reportRunKey(scout.id, result.generatedAt);
    pendingReportSaveRunKeys = [...new Set([...pendingReportSaveRunKeys, runKey])];
    failedReportSaveRunKeys = failedReportSaveRunKeys.filter((key) => key !== runKey);

    try {
      const response = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scoutId: scout.id,
          scoutName: scout.name,
          scoutConfig: scoutConfigSnapshot(scout),
          generatedAt: result.generatedAt,
          result
        })
      });

      const payload = (await response.json().catch(() => ({}))) as { report?: ScoutReport; error?: string };
      if (!response.ok || !payload.report) {
        throw new Error(payload.error || 'Failed to save report.');
      }

      savedReports = sortReports([payload.report, ...savedReports.filter((report) => report.id !== payload.report?.id)]);
      pendingReportSaveRunKeys = pendingReportSaveRunKeys.filter((key) => key !== runKey);
      failedReportSaveRunKeys = failedReportSaveRunKeys.filter((key) => key !== runKey);
      if (reportTab === `live:${scoutId}`) {
        reportTab = payload.report.id;
        persistWorkspace();
      }
      showToast(`Report saved for ${payload.report.scoutName}.`, 'success');
    } catch (error) {
      pendingReportSaveRunKeys = pendingReportSaveRunKeys.filter((key) => key !== runKey);
      failedReportSaveRunKeys = [...new Set([...failedReportSaveRunKeys, runKey])];
      showToast(error instanceof Error ? error.message : 'Failed to save report.', 'error');
    }
  }

  async function deleteSelectedReport() {
    if (!selectedSavedReport) return;
    const reportToDelete = selectedSavedReport;
    const confirmed = confirm('Delete this saved report?');
    if (!confirmed) return;

    try {
      const response = await fetch(reportUrl(reportToDelete.id), { method: 'DELETE' });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to delete report.');
      }

      const runKey = reportRunKey(reportToDelete.scoutId, reportToDelete.generatedAt);
      suppressedReportRunKeys = [...new Set([...suppressedReportRunKeys, runKey])];
      savedReports = sortReports(savedReports.filter((report) => report.id !== reportToDelete.id));
      reportTab = 'all';
      persistWorkspace();
      showToast('Report deleted.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to delete report.', 'error');
    }
  }

  function scoreStyle(score: number) {
    const bounded = Math.max(0, Math.min(100, score));
    const hue = Math.round((bounded / 100) * 145);
    const lightBackground = `hsl(${hue} 76% 96%)`;
    const softAccent = `hsl(${hue} 72% 88%)`;
    const border = `hsl(${hue} 55% 76%)`;
    return `--score:${bounded};--score-hue:${hue};--score-bg:${lightBackground};--score-soft:${softAccent};--score-border:${border};`;
  }

  function recommendationLabel(recommendation?: EvaluatedCandidate['evaluation']['recommendation']) {
    if (recommendation === 'strong_fit') return 'Strong fit';
    if (recommendation === 'possible_fit') return 'Possible fit';
    return 'Weak fit';
  }

  function candidateRunStatus(candidate: ReportCandidate) {
    if (candidate.evaluation) return 'evaluated';
    return 'evaluationStatus' in candidate ? candidate.evaluationStatus : 'found';
  }

  function candidateStatusLabel(candidate: ReportCandidate) {
    const status = candidateRunStatus(candidate);
    if (status === 'evaluating') return 'Analyzing now';
    if (status === 'found') return 'Waiting for scoring';
    return 'Scored';
  }

  function candidatePendingSummary(candidate: ReportCandidate) {
    if (candidateRunStatus(candidate) === 'evaluating') {
      return 'Analyzing this candidate now. Profile details, public links, and fit criteria are being reviewed.';
    }
    return 'Candidate found. AI scoring will fill in fit details shortly.';
  }

  function formatReportDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown date';
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function normalizeReportScoreRange(minScore: number, maxScore: number) {
    const min = Math.max(0, Math.min(100, Number(minScore) || 0));
    const max = Math.max(0, Math.min(100, Number(maxScore) || 0));
    return {
      min: Math.min(min, max),
      max: Math.max(min, max)
    };
  }

  function scoreInReportRange(score: number, range: ScoreRange) {
    return score >= range.min && score <= range.max;
  }

  function filterReportCandidatesByScore(candidates: ReportCandidate[], range: ScoreRange) {
    return candidates.filter((candidate) => !candidate.evaluation || scoreInReportRange(candidate.evaluation.fitScore, range));
  }

  function filterReportRowsByScore(rows: ReportCandidateRow[], range: ScoreRange) {
    return rows.filter((row) => !row.candidate.evaluation || scoreInReportRange(row.candidate.evaluation.fitScore, range));
  }

  function filterMergedCandidatesByScore(candidates: MergedCandidate[], range: ScoreRange) {
    return candidates.filter((candidate) => scoreInReportRange(candidate.bestScore, range));
  }

  function resetReportScoreRange() {
    reportMinScore = 0;
    reportMaxScore = 100;
  }

  function runSelectedScout() {
    if (!selectedScout) return;
    runScouts([selectedScout.id]);
  }

  function runAllReadyScouts() {
    const ids = scouts.filter((scout) => canQueueScout(scout)).map((scout) => scout.id);
    runScouts(ids);
  }

  function runScouts(scoutIds: string[]) {
    if (!hasCredentials) {
      showToast('Enter Markidy and AI API keys before running scouts.', 'error');
      return;
    }

    const runnableIds = scoutIds.filter((id) => {
      const scout = scouts.find((item) => item.id === id);
      return scout ? canQueueScout(scout) : false;
    });

    if (!runnableIds.length) {
      showToast('No ready scouts to run. Add a role summary first.', 'error');
      return;
    }

    const scheduled = queueScoutRuns(scouts, runnableIds, maxConcurrentScouts);
    scouts = scheduled.scouts;
    persistWorkspace();

    scheduled.startIds.forEach((id) => {
      void executeScout(id);
    });
  }

  function stopScout(scoutId: string) {
    abortControllers.get(scoutId)?.abort();
    abortControllers.delete(scoutId);

    patchScouts(
      scouts.map((scout) =>
        scout.id === scoutId && (scout.status === 'running' || scout.status === 'queued')
          ? {
              ...scout,
              status: 'stopped' as const,
              phase: 'Stopped by user.',
              errorMessage: ''
            }
          : scout
      ),
      'Scout stopped.'
    );

    maybeStartQueuedScouts();
  }

  function stopAllScouts() {
    abortControllers.forEach((controller) => controller.abort());
    abortControllers.clear();
    patchScouts(
      scouts.map((scout) =>
        scout.status === 'running' || scout.status === 'queued'
          ? {
              ...scout,
              status: 'stopped' as const,
              phase: 'Stopped by user.',
              errorMessage: ''
            }
          : scout
      ),
      'All scouts stopped.'
    );
  }

  async function executeScout(scoutId: string) {
    const scout = scouts.find((item) => item.id === scoutId);
    if (!scout) return;

    const controller = new AbortController();
    abortControllers.set(scoutId, controller);

    try {
      const response = await fetch('/api/find/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildScoutRequest(currentCredentials(), scout)),
        signal: controller.signal
      });

      if (!response.ok || !response.body) {
        let message = 'Find candidates failed.';
        try {
          const payload = (await response.json()) as { error?: string };
          message = payload.error || message;
        } catch {
          message = response.statusText || message;
        }
        handleScoutEvent(scoutId, { type: 'error', message });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            handleScoutEvent(scoutId, JSON.parse(trimmed) as FindStreamEvent);
          } catch (error) {
            handleScoutEvent(scoutId, {
              type: 'warning',
              message: error instanceof Error ? error.message : 'Could not parse one stream event.'
            });
          }
        }
      }

      if (buffer.trim()) {
        try {
          handleScoutEvent(scoutId, JSON.parse(buffer.trim()) as FindStreamEvent);
        } catch {
          handleScoutEvent(scoutId, { type: 'warning', message: 'Could not parse final stream event.' });
        }
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      handleScoutEvent(scoutId, {
        type: 'error',
        message: error instanceof Error ? error.message : 'Unexpected stream error.'
      });
    } finally {
      abortControllers.delete(scoutId);
      maybeStartQueuedScouts();
    }
  }

  function maybeStartQueuedScouts() {
    const nextStartIds = startableScoutIds(scouts, maxConcurrentScouts);
    if (!nextStartIds.length) return;

    scouts = scouts.map((scout) =>
      nextStartIds.includes(scout.id)
        ? {
            ...scout,
            status: 'running' as const,
            phase: 'Starting scout...'
          }
        : scout
    );
    persistWorkspace();
    nextStartIds.forEach((id) => {
      void executeScout(id);
    });
  }

  function handleScoutEvent(scoutId: string, event: FindStreamEvent) {
    scouts = scouts.map((scout) => {
      if (scout.id !== scoutId) return scout;

      if (event.type === 'phase') {
        return { ...scout, phase: event.message };
      }

      if (event.type === 'started') {
        return {
          ...scout,
          generatedAt: event.generatedAt,
          status: 'running' as const,
          phase: 'Searching candidates...'
        };
      }

      if (event.type === 'attempts') {
        return {
          ...scout,
          searchAttempts: event.searchAttempts,
          totals: { ...scout.totals, searchAttempts: event.searchAttempts.length }
        };
      }

      if (event.type === 'attempt_updated') {
        const searchAttempts = updateSearchAttempt(scout.searchAttempts, event.attempt);
        return {
          ...scout,
          searchAttempts,
          totals: {
            ...scout.totals,
            discovered: event.totals.discovered,
            searchAttempts: searchAttempts.length
          }
        };
      }

      if (event.type === 'candidate_found') {
        const candidateRows = upsertFoundCandidate(scout.candidateRows, event.candidate);
        return {
          ...scout,
          candidateRows,
          totals: {
            ...scout.totals,
            discovered: event.totals.discovered
          }
        };
      }

      if (event.type === 'candidate_evaluating') {
        return {
          ...scout,
          phase: 'Scoring candidates...',
          candidateRows: markCandidateEvaluating(scout.candidateRows, event.userId),
          totals: {
            ...scout.totals,
            discovered: event.totals.discovered,
            evaluated: event.totals.evaluated
          }
        };
      }

      if (event.type === 'candidate_evaluated') {
        const candidateRows = upsertEvaluatedCandidate(scout.candidateRows, event.candidate);
        return {
          ...scout,
          candidateRows,
          totals: {
            ...scout.totals,
            discovered: event.totals.discovered,
            evaluated: event.totals.evaluated
          }
        };
      }

      if (event.type === 'warning') {
        return {
          ...scout,
          warnings: [...scout.warnings, event.message]
        };
      }

      if (event.type === 'done') {
        return {
          ...scout,
          status: 'done' as const,
          phase: 'Scout complete.',
          result: event.result,
          generatedAt: event.result.generatedAt,
          searchAttempts: event.result.searchAttempts,
          warnings: event.result.warnings,
          totals: {
            discovered: Math.max(scout.totals.discovered, event.result.candidates.length),
            evaluated: event.result.candidates.length,
            searchAttempts: event.result.searchAttempts.length
          },
          candidateRows: sortCandidateRows(
            event.result.candidates.map((candidate, index) => ({
              ...candidate,
              evaluation: candidate.evaluation,
              evaluationStatus: 'evaluated' as const,
              order: index
            }))
          )
        };
      }

      if (event.type === 'error') {
        return {
          ...scout,
          status: 'failed' as const,
          phase: 'Scout failed.',
          errorMessage: event.message
        };
      }

      return scout;
    });

    persistWorkspace();
    if (event.type === 'done') {
      void saveCompletedScoutReport(scoutId, event.result);
    }
  }

  function upsertFoundCandidate(rows: CandidateRow[], candidate: CandidateProfile) {
    const existing = rows.find((row) => row.userId === candidate.userId);
    if (existing) {
      return sortCandidateRows(rows.map((row) => (row.userId === candidate.userId ? { ...row, ...candidate } : row)));
    }
    return sortCandidateRows([
      ...rows,
      {
        ...candidate,
        evaluationStatus: 'found' as const,
        order: rows.length
      }
    ]);
  }

  function markCandidateEvaluating(rows: CandidateRow[], userId: string) {
    return sortCandidateRows(
      rows.map((row) =>
        row.userId === userId && row.evaluationStatus !== 'evaluated'
          ? { ...row, evaluationStatus: 'evaluating' as const }
          : row
      )
    );
  }

  function upsertEvaluatedCandidate(rows: CandidateRow[], candidate: EvaluatedCandidate) {
    const existingIndex = rows.findIndex((row) => row.userId === candidate.userId);
    const evaluatedRow: CandidateRow = {
      ...candidate,
      evaluation: candidate.evaluation,
      evaluationStatus: 'evaluated',
      order: existingIndex >= 0 ? rows[existingIndex].order : rows.length
    };

    if (existingIndex < 0) {
      return sortCandidateRows([...rows, evaluatedRow]);
    }

    return sortCandidateRows(rows.map((row) => (row.userId === candidate.userId ? evaluatedRow : row)));
  }

  function updateSearchAttempt(searchAttempts: CandidateSearchAttempt[], attempt: CandidateSearchAttempt) {
    const index = searchAttempts.findIndex((item) => item.id === attempt.id);
    if (index < 0) return [...searchAttempts, attempt];
    return searchAttempts.map((item) => (item.id === attempt.id ? attempt : item));
  }

  function exportSelectedJson() {
    if (reportTab === 'all') {
      downloadResultsJson(mergedCandidatesToResult(filteredMergedCandidates));
      return;
    }

    if (selectedSavedReport && filteredSelectedReportResult) {
      downloadText(
        `talent-scout-report-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(
          reportsToSavedReportFile([
            {
              ...selectedSavedReport,
              result: filteredSelectedReportResult
            }
          ]),
          null,
          2
        ),
        'application/json'
      );
    }
  }

  function exportSelectedCsv() {
    if (filteredSelectedReportResult) {
      downloadResultsCsv(filteredSelectedReportResult);
    }
  }

  function exportAllReportsJson() {
    downloadText(
      `talent-scout-all-reports-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(reportsToSavedReportFile(savedReports), null, 2),
      'application/json'
    );
  }

  function visibleCandidateRows(scout: ScoutState) {
    return sortCandidateRows(scout.candidateRows);
  }

  function evaluatedReportRows(scout: ScoutState) {
    return sortCandidateRows(scout.candidateRows).filter((candidate) => candidate.evaluation);
  }
</script>

<svelte:head>
  <title>Talent Scout</title>
  <meta
    name="description"
    content="Talent scouting and reporting for Markidy profiles"
  />
</svelte:head>

<div class="app-shell">
  <ToastContainer {toasts} onDismiss={dismissToast} />

  <header class="topbar">
    <div class="brand">
      <div class="brand-mark" role="img" aria-label="Talent Scout meerkat logo">
        <img src="/talent-scout-logo.png" alt="" />
      </div>
      <div>
        <p class="eyebrow">Markidy</p>
        <h1>Talent Scout</h1>
      </div>
    </div>

    <nav class="workspace-tabs" aria-label="Workspace">
      <button
        type="button"
        class:active={activeWorkspaceTab === 'setup'}
        on:click={() => {
          activeWorkspaceTab = 'setup';
          persistWorkspace();
        }}
      >
        Setup
      </button>
      <button
        type="button"
        class:active={activeWorkspaceTab === 'scouts'}
        on:click={() => {
          activeWorkspaceTab = 'scouts';
          persistWorkspace();
        }}
      >
        Scouts
      </button>
      <button
        type="button"
        class:active={activeWorkspaceTab === 'reports'}
        on:click={() => {
          activeWorkspaceTab = 'reports';
          persistWorkspace();
        }}
      >
        Reports
      </button>
    </nav>

    <div class="topbar-actions">
      <button class="primary-button" type="button" on:click={runAllReadyScouts} disabled={!canRunAll}>
        Run all ready
      </button>
      <button class="danger-button" type="button" on:click={stopAllScouts} disabled={runningCount + queuedCount === 0}>
        Stop all
      </button>
    </div>
  </header>

  {#if activeWorkspaceTab === 'setup'}
    <main class="setup-workspace">
      <section class="form-card setup-card">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Shared setup</p>
            <h2>API credentials</h2>
          </div>
          <button class="secondary-button" type="button" on:click={() => saveCurrentStep('Setup saved.')}>
            Save setup
          </button>
        </div>

        <div class="setup-grid">
          <label>
            <span>Markidy API URL</span>
            <small>Required. Use the Markidy API base URL.</small>
            <input
              bind:value={markidyApiUrl}
              on:input={onGlobalInput}
              placeholder="https://api.markidy.com"
              autocomplete="off"
            />
          </label>

          <label>
            <span>Markidy API key</span>
            <small>Required. Used only in this browser session.</small>
            <input
              bind:value={markidyApiKey}
              on:input={onGlobalInput}
              placeholder="mk_live_..."
              autocomplete="off"
              type="password"
            />
          </label>

          <label>
            <span>AI provider</span>
            <small>Required. Select the provider used to score candidates.</small>
            <select value={aiProvider} on:change={onProviderChange}>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="gemini">Google Gemini</option>
              <option value="xai">xAI Grok</option>
              <option value="mistral">Mistral AI</option>
            </select>
          </label>

          <label>
            <span>AI model</span>
            <small>Required. Better models usually improve ranking quality.</small>
            <input bind:value={aiModel} on:input={onGlobalInput} placeholder={selectedAiProvider.defaultModel} />
          </label>

          <label>
            <span>AI API key</span>
            <small>Required. Used to evaluate discovered candidates.</small>
            <input
              bind:value={aiApiKey}
              on:input={onGlobalInput}
              placeholder="sk-..."
              autocomplete="off"
              type="password"
            />
          </label>

          <label>
            <span class="field-label-row">
              <span>AI base URL</span>
              <em>Optional</em>
            </span>
            <small>Change only for a compatible custom endpoint.</small>
            <input bind:value={aiBaseUrl} on:input={onGlobalInput} placeholder={selectedAiProvider.defaultBaseUrl} />
          </label>
        </div>

        <div class="setup-footer">
          <p>Keys stay in browser session storage. They are sent only when a scout run calls the local API route.</p>
          <button
            class="primary-button"
            type="button"
            on:click={() => {
              activeWorkspaceTab = 'scouts';
              persistWorkspace('Setup saved.');
            }}
          >
            Continue to scouts
          </button>
        </div>
      </section>
    </main>
  {:else if activeWorkspaceTab === 'scouts'}
    <main class="scout-workspace">
      <aside class="side-panel scout-list-panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Operations</p>
            <h2>Scouts</h2>
          </div>
          <div class="header-actions">
            <button class="icon-button" type="button" aria-label="New scout" on:click={createNewScout}>+</button>
          </div>
        </div>

        <div class="scout-list">
          {#each scouts as scout}
            <button
              type="button"
              class="scout-list-item"
              class:active={selectedScout?.id === scout.id}
              on:click={() => {
                selectedScoutId = scout.id;
                persistWorkspace();
              }}
            >
              <span class="scout-list-top">
                <strong>{scout.name}</strong>
                <span class={`status-badge ${scout.status}`}>{scout.status}</span>
              </span>
              <span class="scout-meta">
                {scout.totals.discovered} found · {scout.totals.evaluated} scored
              </span>
              <span class="scout-meta">
                Best {bestScoutScore(scout) ?? '--'} · {activeSearchFilters(scout)}
              </span>
            </button>
          {/each}
        </div>
      </aside>

      <section class="editor-column">
        {#if selectedScout}
          <section class="form-card">
            <div class="section-heading">
              <div>
                <p class="eyebrow">Scout setup</p>
                <h2>{selectedScout.name}</h2>
              </div>
              <div class="button-row">
                <button class="secondary-button" type="button" on:click={duplicateSelectedScout}>
                  Copy
                </button>
                <button
                  class="secondary-button"
                  type="button"
                  on:click={() => saveCurrentStep('Scout saved.')}
                >
                  Save
                </button>
                <button class="primary-button" type="button" on:click={runSelectedScout} disabled={!hasCredentials || !canQueueScout(selectedScout)}>
                  Run this scout
                </button>
                <button class="danger-button" type="button" on:click={removeSelectedScout} disabled={scouts.length <= 1 || selectedScout.status === 'running'}>
                  Delete scout
                </button>
              </div>
            </div>

            <div class="field-stack">
              <label>
                <span>Scout name</span>
                <small>Required. Use a name that makes reports easy to compare.</small>
                <input
                  value={selectedScout.name}
                  disabled={selectedScoutLocked}
                  placeholder="Backend platform scout"
                  on:input={(event) =>
                    patchScoutConfig(selectedScout.id, { name: (event.currentTarget as HTMLInputElement).value })}
                />
              </label>

              <label>
                <span>Role summary</span>
                <small>Required. Primary basis for search expansion and AI fit scoring.</small>
                <textarea
                  rows="4"
                  value={selectedScout.roleSummary}
                  disabled={selectedScoutLocked}
                  placeholder="Find a backend engineer who can design APIs, work with PostgreSQL, and own production systems."
                  on:input={(event) =>
                    patchScoutConfig(selectedScout.id, {
                      roleSummary: (event.currentTarget as HTMLTextAreaElement).value
                    })}
                ></textarea>
              </label>

              <label>
                <span class="field-label-row">
                  <span>Ideal candidate</span>
                  <em>Optional</em>
                </span>
                <small>Adds nuance when candidates have similar objective signals.</small>
                <textarea
                  rows="3"
                  value={selectedScout.idealCandidate}
                  disabled={selectedScoutLocked}
                  placeholder="Prefers clear communication, product-minded tradeoffs, and strong ownership."
                  on:input={(event) =>
                    patchScoutConfig(selectedScout.id, {
                      idealCandidate: (event.currentTarget as HTMLTextAreaElement).value
                    })}
                ></textarea>
              </label>
            </div>

            <div class="filters-grid">
              <label>
                <span class="field-label-row">
                  <span>Required skills</span>
                  <em>Optional</em>
                </span>
                <small>Separate by comma. These guide search and scoring.</small>
                <input
                  value={selectedScout.skills}
                  disabled={selectedScoutLocked}
                  placeholder="TypeScript, PostgreSQL, API design"
                  on:input={(event) =>
                    patchScoutConfig(selectedScout.id, { skills: (event.currentTarget as HTMLInputElement).value })}
                />
              </label>

              <label>
                <span class="field-label-row">
                  <span>Minimum years</span>
                  <em>Optional</em>
                </span>
                <small>Leave 0 if experience should not filter candidates.</small>
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={selectedScout.minExperienceYears}
                  disabled={selectedScoutLocked}
                  placeholder="3"
                  on:input={(event) =>
                    patchScoutConfig(selectedScout.id, {
                      minExperienceYears: Number((event.currentTarget as HTMLInputElement).value || 0)
                    })}
                />
              </label>

              <label>
                <span>Max candidates</span>
                <small>Required. Higher values take longer and cost more AI tokens.</small>
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={selectedScout.maxCandidates}
                  disabled={selectedScoutLocked}
                  placeholder="50"
                  on:input={(event) =>
                    patchScoutConfig(selectedScout.id, {
                      maxCandidates: Number((event.currentTarget as HTMLInputElement).value || 1)
                    })}
                />
              </label>

              <label>
                <span>Search attempts</span>
                <small>Required. More attempts broaden discovery but take longer. Use 1-10.</small>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={selectedScout.searchAttemptsLimit}
                  disabled={selectedScoutLocked}
                  placeholder="6"
                  on:input={(event) =>
                    patchScoutConfig(selectedScout.id, {
                      searchAttemptsLimit: Math.max(
                        1,
                        Math.min(10, Number((event.currentTarget as HTMLInputElement).value || 6))
                      )
                    })}
                />
              </label>

              <label>
                <span class="field-label-row">
                  <span>Locations</span>
                  <em>Optional</em>
                </span>
                <small>Free text for city, region, or time zone hints.</small>
                <input
                  value={selectedScout.locations}
                  disabled={selectedScoutLocked}
                  placeholder="New York, London, Remote US"
                  on:input={(event) =>
                    patchScoutConfig(selectedScout.id, { locations: (event.currentTarget as HTMLInputElement).value })}
                />
              </label>
            </div>

            <div class="country-block">
              <CountryMultiSelect
                selected={selectedScout.countries}
                disabled={selectedScoutLocked}
                help="Search by country name or ISO code. Selected countries become tags."
                onSelectedChange={(countries) => patchScoutConfig(selectedScout.id, { countries })}
              />
            </div>

            <div class="work-mode-block">
              <div class="field-label-row">
                <span class="field-title">Work modes</span>
                <em>Optional</em>
              </div>
              <small>Use only when work mode is a real constraint.</small>
              <div class="chip-grid">
                {#each workModeOptions as option}
                  <button
                    type="button"
                    class="filter-chip"
                    class:active={selectedScout.workModes.includes(option.value)}
                    disabled={selectedScoutLocked}
                    on:click={() => toggleScoutWorkMode(selectedScout, option.value)}
                  >
                    {option.label}
                  </button>
                {/each}
              </div>
            </div>

          </section>
        {/if}
      </section>

      {#if selectedScout}
        <aside class="side-panel progress-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Live run</p>
              <h2>Progress</h2>
            </div>
            <div class="progress-actions">
              <span class={`status-badge ${selectedScout.status}`}>{selectedScout.status}</span>
              {#if selectedScout.status === 'running' || selectedScout.status === 'queued'}
                <button class="danger-button compact" type="button" on:click={() => stopScout(selectedScout.id)}>
                  Stop
                </button>
              {/if}
            </div>
          </div>

          <div class="progress-card">
            <p class="phase">{selectedScout.phase || 'Waiting to run.'}</p>
            <div class="metric-grid">
              <div>
                <strong>{selectedScout.totals.discovered}</strong>
                <span>Found</span>
              </div>
              <div>
                <strong>{selectedScout.totals.evaluated}</strong>
                <span>Scored</span>
              </div>
              <div>
                <strong>{selectedScout.totals.searchAttempts}</strong>
                <span>Attempts</span>
              </div>
              <div>
                <strong>{bestScoutScore(selectedScout) ?? '--'}</strong>
                <span>Best</span>
              </div>
            </div>
          </div>

          {#if selectedScout.errorMessage}
            <p class="inline-error">{selectedScout.errorMessage}</p>
          {/if}

          {#if selectedScout.warnings.length}
            <div class="mini-section">
              <h3>Warnings</h3>
              {#each selectedScout.warnings.slice(-4) as warning}
                <p>{warning}</p>
              {/each}
            </div>
          {/if}

          {#if selectedScout.searchAttempts.length}
            <div class="mini-section">
              <h3>Search attempts</h3>
              {#each selectedScout.searchAttempts.slice(-6) as attempt}
                <div class="attempt-row">
                  <span>{attempt.label || attempt.q || attempt.roles.join(', ') || 'Search attempt'}</span>
                  <small>{attempt.resultCount} found</small>
                </div>
              {/each}
            </div>
          {/if}

          {#if visibleCandidateRows(selectedScout).length}
            <div class="mini-section">
              <h3>Recent candidates</h3>
              {#each visibleCandidateRows(selectedScout).slice(0, 5) as candidate}
                <div class="recent-candidate">
                  <span>{candidate.name}</span>
                  <small>{candidate.evaluation?.fitScore ?? 'scoring'} · {candidate.evaluationStatus}</small>
                </div>
              {/each}
            </div>
          {/if}
        </aside>
      {/if}
    </main>
  {:else}
    <main class="reports-workspace">
      <section class="report-shell">
        <div class="report-header">
          <div>
            <p class="eyebrow">Reports</p>
            <h2>Candidate reports</h2>
          </div>
          <div class="button-row">
            {#if selectedSavedReport}
              <button class="danger-button" type="button" on:click={deleteSelectedReport}>
                Delete report
              </button>
            {/if}
            <button class="secondary-button" type="button" on:click={exportSelectedCsv} disabled={!filteredSelectedReportResult?.candidates.length}>
              Export selected CSV
            </button>
            <button class="secondary-button" type="button" on:click={exportSelectedJson} disabled={!filteredSelectedReportResult?.candidates.length}>
              Export selected JSON
            </button>
            <button class="secondary-button" type="button" on:click={loadSavedReports} disabled={reportsLoading}>
              Reload reports
            </button>
            <button class="primary-button" type="button" on:click={exportAllReportsJson} disabled={!savedReports.length}>
              Export all
            </button>
          </div>
        </div>

        <div class="report-filter-bar">
          <div class="report-filter-summary">
            <span>Score range</span>
            <p>{activeReportVisibleCount} of {activeReportTotal} candidates</p>
          </div>
          <label class="score-filter-field">
            <span>Min</span>
            <input type="number" min="0" max="100" step="1" bind:value={reportMinScore} />
          </label>
          <label class="score-filter-field">
            <span>Max</span>
            <input type="number" min="0" max="100" step="1" bind:value={reportMaxScore} />
          </label>
          <button class="secondary-button compact" type="button" on:click={resetReportScoreRange} disabled={reportMinScore === 0 && reportMaxScore === 100}>
            Reset
          </button>
        </div>

        <div class="report-tabs" aria-label="Reports">
          <button
            type="button"
            class:active={reportTab === 'all'}
            on:click={() => {
              reportTab = 'all';
              persistWorkspace();
            }}
          >
            All reports
            <span>{reportMergedCandidates.length + allPendingReportRows.length}</span>
          </button>
          {#each reportViews as report}
            <button
              type="button"
              class:live={report.kind === 'live'}
              class:active={reportTab === report.id}
              on:click={() => {
                reportTab = report.id;
                persistWorkspace();
              }}
            >
              {report.scoutName}
              <em>{report.kind === 'live' ? report.status : formatReportDate(report.generatedAt)}</em>
              <span>{report.candidates.length}</span>
            </button>
          {/each}
        </div>

        {#if reportTab === 'all'}
          {#if filteredAllPendingRows.length || filteredMergedCandidates.length}
            <div class="candidate-list">
              {#each filteredAllPendingRows as row (row.key)}
                {@render candidateCard(row.candidate, row.scoutName)}
              {/each}
              {#each filteredMergedCandidates as merged}
                {@render mergedCandidateCard(merged)}
              {/each}
            </div>
          {:else if reportMergedCandidates.length || allPendingReportRows.length}
            {@render emptyReport('No candidates match the selected score range.')}
          {:else if reportsLoading}
            {@render emptyReport('Loading saved reports.')}
          {:else}
            {@render emptyReport('Run one or more scouts to create reports.')}
          {/if}
        {:else if selectedReportView}
          {@render reportStatusPanel(selectedReportView)}
          {#if filteredReportCandidates.length}
            <div class="candidate-list">
              {#each filteredReportCandidates as candidate}
                {@render candidateCard(candidate, selectedReportView.scoutName)}
              {/each}
            </div>
          {:else if selectedReportView.candidates.length}
            {@render emptyReport('No candidates match the selected score range.')}
          {:else if selectedReportView.kind === 'live'}
            {@render emptyReport('Waiting for candidates.')}
          {:else}
            {@render emptyReport('This report has no candidates.')}
          {/if}
        {/if}
      </section>
    </main>
  {/if}
</div>

{#snippet reportStatusPanel(report: ReportView)}
  <div class="report-run-status">
    <div class="report-run-heading">
      <div>
        <h3>{report.scoutName}</h3>
        <p>{report.phase}</p>
      </div>
      <span class={`status-badge ${report.status}`}>{report.kind === 'live' ? report.status : 'saved'}</span>
    </div>

    <div class="report-metric-row">
      <span><strong>{report.totals.discovered}</strong> found</span>
      <span><strong>{report.totals.evaluated}</strong> scored</span>
      <span><strong>{report.totals.searchAttempts}</strong> attempts</span>
      <span><strong>{report.kind === 'saved' ? formatReportDate(report.generatedAt) : `${reportProgressPercent(report)}%`}</strong> {report.kind === 'saved' ? 'created' : 'complete'}</span>
    </div>

    <div class="report-progress-track" aria-hidden="true">
      <span style={`width: ${reportProgressPercent(report)}%;`}></span>
    </div>

    {#if report.searchAttempts.length}
      <div class="report-attempt-list">
        {#each report.searchAttempts.slice(0, 6) as attempt}
          <span>{attempt.label || attempt.q || attempt.roles.join(', ') || 'Search attempt'} <strong>{attempt.resultCount}</strong></span>
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

{#snippet scoreBadge(candidate: CandidateRow | EvaluatedCandidate)}
  {#if candidate.evaluation}
    <div class="score-badge">
      <strong>{candidate.evaluation.fitScore}</strong>
      <span>{recommendationLabel(candidate.evaluation.recommendation)}</span>
    </div>
  {:else}
    <div class="score-badge pending">
      <strong>--</strong>
      <span>{'evaluationStatus' in candidate && candidate.evaluationStatus === 'evaluating' ? 'Scoring' : 'Queued'}</span>
    </div>
  {/if}
{/snippet}

{#snippet linkEvidence(candidate: CandidateRow | EvaluatedCandidate)}
  {#if candidate.linkInsights?.length}
    <div class="link-evidence">
      <h4>Public links</h4>
      <div class="link-evidence-list">
        {#each candidate.linkInsights.slice(0, 5) as link}
          <a href={link.url} target="_blank" rel="noreferrer" title={link.url}>
            {linkDisplayTitle(link)}
            <span>{linkDisplayMeta(link)}</span>
          </a>
        {/each}
      </div>
    </div>
  {/if}
{/snippet}

{#snippet candidateBody(candidate: CandidateRow | EvaluatedCandidate)}
    <div class="candidate-summary">
    {#if candidate.evaluation?.summary}
      <p>{candidate.evaluation.summary}</p>
    {:else}
      {#if candidateRunStatus(candidate) === 'evaluating'}
        <div class="analysis-status-line">
          <span aria-hidden="true"></span>
          <strong>Analyzing candidate</strong>
        </div>
      {/if}
      <p>{candidatePendingSummary(candidate)}</p>
    {/if}
  </div>

  {@render linkEvidence(candidate)}

  {#if candidate.evaluation}
    <div class="detail-grid">
      <div>
        <h4>Specific matches</h4>
        {#if candidate.evaluation.objectiveMatches.length}
          <ul>
            {#each candidate.evaluation.objectiveMatches as match}
              <li>{match}</li>
            {/each}
          </ul>
        {:else}
          <p>No clear matches found yet.</p>
        {/if}
      </div>
      <div>
        <h4>Gaps</h4>
        {#if candidate.evaluation.objectiveMisses.length}
          <ul>
            {#each candidate.evaluation.objectiveMisses as miss}
              <li>{miss}</li>
            {/each}
          </ul>
        {:else}
          <p>No major gaps identified.</p>
        {/if}
      </div>
      <div>
        <h4>Fit reasons</h4>
        {#if candidate.evaluation.fitReasons.length}
          <ul>
            {#each candidate.evaluation.fitReasons as reason}
              <li>{reason}</li>
            {/each}
          </ul>
        {:else}
          <p>No extra reasons returned.</p>
        {/if}
      </div>
      <div>
        <h4>Risks</h4>
        {#if candidate.evaluation.risks.length}
          <ul>
            {#each candidate.evaluation.risks as risk}
              <li>{risk}</li>
            {/each}
          </ul>
        {:else}
          <p>No clear risks found.</p>
        {/if}
      </div>
    </div>
  {/if}
{/snippet}

{#snippet candidateCard(candidate: CandidateRow | EvaluatedCandidate, scoutName = '')}
  <article
    class="candidate-card"
    class:pending={!candidate.evaluation}
    class:analyzing={candidateRunStatus(candidate) === 'evaluating'}
    style={candidate.evaluation ? scoreStyle(candidate.evaluation.fitScore) : ''}
  >
    <div class="candidate-top">
      <div class="avatar">{candidate.name.slice(0, 1).toUpperCase()}</div>
      <div class="candidate-title">
        <h3>{candidate.name}</h3>
        <p>
          <span>{candidate.sourceLabel}</span>
          {#if candidate.country}<span>{candidate.country}</span>{/if}
          {#if candidate.verifiedLevel}<span>Verified {candidate.verifiedLevel}</span>{/if}
          {#if scoutName}<span>{scoutName}</span>{/if}
          {#if candidateRunStatus(candidate) !== 'evaluated'}
            <span class={`candidate-state ${candidateRunStatus(candidate)}`}>{candidateStatusLabel(candidate)}</span>
          {/if}
        </p>
      </div>
      {@render scoreBadge(candidate)}
    </div>

    {@render candidateBody(candidate)}

    <div class="candidate-actions">
      {#if candidate.profileUrl}
        <a href={candidate.profileUrl} target="_blank" rel="noreferrer">Open Markidy profile</a>
      {/if}
    </div>
  </article>
{/snippet}

{#snippet mergedCandidateCard(merged: MergedCandidate)}
  <article class="candidate-card" style={scoreStyle(merged.bestScore)}>
    <div class="candidate-top">
      <div class="avatar">{merged.bestCandidate.name.slice(0, 1).toUpperCase()}</div>
      <div class="candidate-title">
        <h3>{merged.bestCandidate.name}</h3>
        <p>
          <span>Matched by {merged.matchedScouts.length} scout{merged.matchedScouts.length === 1 ? '' : 's'}</span>
          {#if merged.bestCandidate.country}<span>{merged.bestCandidate.country}</span>{/if}
          {#if merged.bestCandidate.verifiedLevel}<span>Verified {merged.bestCandidate.verifiedLevel}</span>{/if}
        </p>
      </div>
      {@render scoreBadge(merged.bestCandidate)}
    </div>

    <div class="scout-score-row">
      {#each merged.matchedScouts as match}
        <span>{match.scoutName}: {match.fitScore}</span>
      {/each}
    </div>

    {@render candidateBody(merged.bestCandidate)}

    <div class="candidate-actions">
      {#if merged.bestCandidate.profileUrl}
        <a href={merged.bestCandidate.profileUrl} target="_blank" rel="noreferrer">Open Markidy profile</a>
      {/if}
    </div>
  </article>
{/snippet}

{#snippet emptyReport(message: string)}
  <div class="empty-state">
    <h3>No candidates found</h3>
    <p>{message}</p>
  </div>
{/snippet}

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    background: #f5f7fb;
    color: #172033;
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  button,
  input,
  textarea,
  select {
    font: inherit;
  }

  button {
    cursor: pointer;
  }

  button:disabled,
  input:disabled,
  textarea:disabled {
    cursor: not-allowed;
    opacity: 0.62;
  }

  .app-shell {
    min-height: 100vh;
  }

  .topbar {
    position: sticky;
    top: 0;
    z-index: 10;
    display: grid;
    grid-template-columns: minmax(260px, 1fr) auto minmax(320px, 1fr);
    gap: 24px;
    align-items: center;
    padding: 16px 24px;
    border-bottom: 1px solid #dce3ef;
    background: rgba(255, 255, 255, 0.94);
    backdrop-filter: blur(16px);
  }

  .brand,
  .candidate-top,
  .panel-heading,
  .section-heading,
  .report-header,
  .button-row {
    display: flex;
    align-items: center;
  }

  .brand {
    gap: 12px;
  }

  .brand-mark {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 10px;
    overflow: hidden;
    background: white;
    box-shadow: inset 0 0 0 1px #d7e1f0;
  }

  .brand-mark img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .avatar {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 999px;
    background: #255ee8;
    color: white;
    font-weight: 800;
  }

  .brand h1,
  .section-heading h2,
  .panel-heading h2,
  .report-header h2 {
    margin: 0;
    font-size: 20px;
    letter-spacing: 0;
  }

  .eyebrow {
    margin: 0 0 2px;
    color: #68758a;
    font-size: 12px;
    font-weight: 800;
    text-transform: uppercase;
  }

  .workspace-tabs {
    display: inline-flex;
    gap: 4px;
    padding: 4px;
    border: 1px solid #dce3ef;
    border-radius: 10px;
    background: #edf2f9;
  }

  .workspace-tabs button,
  .report-tabs button {
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: #4c5a70;
    font-weight: 750;
  }

  .workspace-tabs button {
    padding: 10px 18px;
  }

  .workspace-tabs button.active,
  .report-tabs button.active {
    background: white;
    color: #111827;
    box-shadow: 0 1px 4px rgba(15, 23, 42, 0.1);
  }

  .topbar-actions,
  .header-actions,
  .button-row {
    justify-content: flex-end;
    gap: 8px;
  }

  .header-actions {
    display: inline-flex;
    align-items: center;
  }

  .header-actions .icon-button {
    min-height: 34px;
    height: 34px;
  }

  .header-actions .icon-button {
    width: 34px;
    font-size: 20px;
  }

  .progress-actions {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .primary-button,
  .secondary-button,
  .danger-button,
  .icon-button,
  .candidate-actions a {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 38px;
    border-radius: 8px;
    padding: 0 14px;
    border: 1px solid transparent;
    font-weight: 800;
    text-decoration: none;
  }

  .primary-button {
    background: #111827;
    color: white;
  }

  .secondary-button {
    border-color: #cfd8e6;
    background: white;
    color: #172033;
  }

  .danger-button {
    border-color: #ffd5d5;
    background: #fff4f4;
    color: #a52828;
  }

  .icon-button {
    width: 38px;
    padding: 0;
    background: #111827;
    color: white;
    font-size: 22px;
  }

  .compact {
    min-height: 30px;
    padding: 0 10px;
    font-size: 12px;
  }

  .inline-error {
    background: #fff1f1;
    color: #ab2525;
  }

  .scout-workspace {
    display: grid;
    grid-template-columns: 280px minmax(480px, 1fr) 360px;
    gap: 18px;
    max-width: 1580px;
    margin: 18px auto 0;
    padding: 0 24px 36px;
  }

  .setup-workspace,
  .reports-workspace {
    max-width: 1180px;
    margin: 18px auto 0;
    padding: 0 24px 36px;
  }

  .setup-card {
    max-width: 980px;
    margin: 0 auto;
  }

  .setup-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-top: 18px;
    border-top: 1px solid #e5ecf5;
    padding-top: 16px;
  }

  .setup-footer p {
    margin: 0;
    color: #65758d;
    line-height: 1.45;
  }

  .side-panel,
  .form-card,
  .report-shell {
    border: 1px solid #dbe3ef;
    border-radius: 10px;
    background: white;
    box-shadow: 0 8px 28px rgba(29, 46, 73, 0.05);
  }

  .side-panel {
    position: sticky;
    top: 92px;
    height: calc(100vh - 116px);
    overflow: auto;
    padding: 16px;
  }

  .editor-column {
    display: grid;
    gap: 16px;
    min-width: 0;
  }

  .form-card,
  .report-shell {
    padding: 18px;
  }

  .section-heading,
  .panel-heading,
  .report-header {
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 16px;
  }

  .setup-grid,
  .filters-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
  }

  .field-stack {
    display: grid;
    gap: 14px;
  }

  label,
  .country-block,
  .work-mode-block {
    display: grid;
    gap: 6px;
  }

  label span,
  .field-title {
    color: #1f2937;
    font-weight: 850;
  }

  .field-label-row {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .field-label-row span {
    color: #1f2937;
    font-weight: 850;
  }

  .field-label-row em {
    display: inline-flex;
    align-items: center;
    min-height: 20px;
    border-radius: 999px;
    padding: 2px 7px;
    background: #f1f5f9;
    color: #64748b;
    font-size: 10px;
    font-style: normal;
    font-weight: 850;
    line-height: 1;
    text-transform: uppercase;
  }

  small {
    color: #66758a;
    line-height: 1.35;
  }

  input,
  textarea,
  select {
    width: 100%;
    border: 1px solid #cfd8e6;
    border-radius: 8px;
    background: #fbfdff;
    color: #172033;
    padding: 11px 12px;
    outline: none;
  }

  textarea {
    resize: vertical;
  }

  input:focus,
  textarea:focus,
  select:focus {
    border-color: #255ee8;
    box-shadow: 0 0 0 3px rgba(37, 94, 232, 0.14);
  }

  .filters-grid,
  .country-block,
  .work-mode-block {
    margin-top: 14px;
  }

  .chip-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .filter-chip {
    border: 1px solid #cfd8e6;
    border-radius: 999px;
    background: white;
    padding: 8px 12px;
    color: #425066;
    font-weight: 760;
  }

  .filter-chip.active {
    border-color: #255ee8;
    background: #edf4ff;
    color: #174bbf;
  }

  .scout-list {
    display: grid;
    gap: 10px;
  }

  .scout-list-item {
    display: grid;
    gap: 7px;
    width: 100%;
    border: 1px solid #dce3ef;
    border-radius: 10px;
    background: #fbfdff;
    padding: 12px;
    text-align: left;
  }

  .scout-list-item.active {
    border-color: #255ee8;
    background: #edf4ff;
  }

  .scout-list-top,
  .scout-meta,
  .attempt-row,
  .recent-candidate,
  .scout-score-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .scout-meta {
    color: #65758d;
    font-size: 13px;
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 4px 8px;
    background: #eef2f7;
    color: #4b5c72;
    font-size: 11px;
    font-weight: 850;
    text-transform: uppercase;
  }

  .status-badge.ready,
  .status-badge.done {
    background: #e8fbf1;
    color: #0c6b43;
  }

  .status-badge.running {
    background: #edf4ff;
    color: #174bbf;
  }

  .status-badge.queued {
    background: #fff8dc;
    color: #846100;
  }

  .status-badge.failed,
  .status-badge.stopped {
    background: #fff1f1;
    color: #9f2222;
  }

  .progress-card {
    border-radius: 10px;
    background: #f6f9fd;
    padding: 14px;
  }

  .phase {
    margin: 0 0 12px;
    color: #273349;
    font-weight: 800;
  }

  .metric-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }

  .metric-grid div {
    border-radius: 8px;
    background: white;
    padding: 12px;
  }

  .metric-grid strong {
    display: block;
    color: #111827;
    font-size: 22px;
  }

  .metric-grid span {
    color: #68758a;
    font-size: 12px;
    font-weight: 750;
  }

  .inline-error {
    border-radius: 8px;
    padding: 10px;
    font-weight: 750;
  }

  .mini-section {
    margin-top: 16px;
    border-top: 1px solid #e5ecf5;
    padding-top: 14px;
  }

  .mini-section h3 {
    margin: 0 0 10px;
    font-size: 13px;
    text-transform: uppercase;
  }

  .mini-section p,
  .attempt-row,
  .recent-candidate {
    margin: 0 0 8px;
    color: #4e5f76;
    font-size: 13px;
  }

  .attempt-row span,
  .recent-candidate span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .report-filter-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 10px;
    margin-bottom: 16px;
    border-top: 1px solid #e1e8f2;
    border-bottom: 1px solid #e1e8f2;
    padding: 12px 0;
  }

  .report-filter-summary {
    min-width: 190px;
    margin-right: auto;
  }

  .report-filter-summary span,
  .score-filter-field span {
    color: #1f2937;
    font-size: 12px;
    font-weight: 850;
  }

  .report-filter-summary p {
    margin: 3px 0 0;
    color: #66758a;
    font-size: 13px;
    font-weight: 700;
  }

  .score-filter-field {
    display: grid;
    width: 96px;
    gap: 5px;
  }

  .score-filter-field input {
    min-height: 34px;
    padding: 7px 9px;
  }

  .report-run-status {
    display: grid;
    gap: 12px;
    margin-bottom: 14px;
    border: 1px solid #dbe3ef;
    border-radius: 10px;
    background: #fbfdff;
    padding: 14px;
  }

  .report-run-heading,
  .report-metric-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .report-run-heading h3 {
    margin: 0;
    font-size: 16px;
  }

  .report-run-heading p {
    margin: 4px 0 0;
    color: #66758a;
    font-size: 13px;
    font-weight: 700;
  }

  .report-metric-row {
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .report-metric-row span {
    border-radius: 8px;
    background: white;
    padding: 8px 10px;
    color: #64748b;
    font-size: 12px;
    font-weight: 800;
  }

  .report-metric-row strong {
    color: #111827;
    font-size: 15px;
  }

  .report-progress-track {
    height: 8px;
    overflow: hidden;
    border-radius: 999px;
    background: #e5ecf5;
  }

  .report-progress-track span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: #255ee8;
    transition: width 180ms ease;
  }

  .report-attempt-list,
  .link-evidence-list {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
  }

  .report-attempt-list span {
    border-radius: 999px;
    background: #f1f5f9;
    color: #46566d;
    padding: 5px 8px;
    font-size: 12px;
    font-weight: 750;
  }

  .report-attempt-list strong {
    color: #172033;
  }

  .report-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 18px;
    border-bottom: 1px solid #e1e8f2;
    padding-bottom: 12px;
  }

  .report-tabs button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 1px solid #dbe3ef;
    padding: 9px 12px;
  }

  .report-tabs button.live {
    border-color: #b8cdfa;
    background: #f7faff;
  }

  .report-tabs span {
    min-width: 24px;
    border-radius: 999px;
    background: #eef2f7;
    padding: 2px 7px;
    font-size: 12px;
  }

  .report-tabs em {
    color: #68758a;
    font-size: 12px;
    font-style: normal;
    font-weight: 700;
  }

  .candidate-list {
    display: grid;
    gap: 14px;
  }

  .candidate-card {
    --score-bg: #f8fafc;
    --score-soft: #e9eef6;
    --score-border: #d7dfec;
    display: grid;
    gap: 14px;
    border: 1px solid var(--score-border);
    border-radius: 10px;
    background:
      linear-gradient(90deg, var(--score-bg) 0%, #ffffff 42%),
      #ffffff;
    padding: 18px;
  }

  .candidate-card.pending {
    border-style: dashed;
    background: white;
  }

  .candidate-card.analyzing {
    border-color: #9bb8f5;
    background:
      linear-gradient(90deg, rgba(37, 94, 232, 0.08) 0%, #ffffff 46%),
      #ffffff;
    box-shadow: 0 0 0 1px rgba(37, 94, 232, 0.08), 0 10px 30px rgba(37, 94, 232, 0.08);
  }

  .candidate-top {
    gap: 12px;
  }

  .candidate-title {
    min-width: 0;
    flex: 1;
  }

  .candidate-title h3 {
    margin: 0 0 4px;
    font-size: 19px;
  }

  .candidate-title p {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0;
    color: #64748b;
    font-size: 13px;
    font-weight: 700;
  }

  .candidate-title p span:not(:last-child)::after {
    content: " |";
    color: #98a4b7;
    margin-left: 8px;
  }

  .candidate-state {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 2px 7px;
    background: #f1f5f9;
    color: #475569;
    font-size: 11px;
    font-weight: 850;
  }

  .candidate-state.evaluating {
    background: #edf4ff;
    color: #174bbf;
  }

  .score-badge {
    display: grid;
    justify-items: end;
    min-width: 92px;
    color: hsl(var(--score-hue) 72% 28%);
  }

  .score-badge strong {
    font-size: 28px;
    line-height: 1;
  }

  .score-badge span {
    color: #4b5563;
    font-size: 12px;
    font-weight: 850;
  }

  .score-badge.pending {
    color: #637083;
  }

  .candidate-summary {
    border-radius: 10px;
    background: color-mix(in srgb, var(--score-soft) 52%, white);
    padding: 12px 14px;
    color: #2d3b52;
    font-weight: 650;
  }

  .candidate-summary p {
    margin: 0;
    line-height: 1.45;
  }

  .analysis-status-line {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 7px;
    color: #174bbf;
    font-size: 12px;
    font-weight: 850;
  }

  .analysis-status-line span {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: #255ee8;
    animation: analysis-pulse 1s ease-in-out infinite;
  }

  @keyframes analysis-pulse {
    0%,
    100% {
      opacity: 0.35;
      transform: scale(0.9);
    }
    50% {
      opacity: 1;
      transform: scale(1.15);
    }
  }

  .link-evidence {
    display: grid;
    gap: 8px;
  }

  .link-evidence h4 {
    margin: 0;
    color: #1f2937;
    font-size: 12px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .link-evidence-list a {
    display: inline-grid;
    max-width: 260px;
    border: 1px solid #dbe3ef;
    border-radius: 8px;
    background: white;
    padding: 7px 9px;
    color: #174bbf;
    font-size: 12px;
    font-weight: 850;
    text-decoration: none;
  }

  .link-evidence-list span {
    overflow: hidden;
    color: #64748b;
    font-size: 11px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .detail-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
  }

  .detail-grid h4 {
    margin: 0 0 7px;
    font-size: 12px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .detail-grid ul,
  .detail-grid p {
    margin: 0;
    padding-left: 18px;
    color: #4b5c72;
    line-height: 1.4;
  }

  .detail-grid p {
    padding-left: 0;
  }

  .candidate-actions {
    display: flex;
    justify-content: flex-end;
  }

  .candidate-actions a {
    background: #111827;
    color: white;
  }

  .scout-score-row {
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .scout-score-row span {
    border-radius: 999px;
    background: #eef4ff;
    color: #174bbf;
    padding: 5px 9px;
    font-size: 12px;
    font-weight: 800;
  }

  .empty-state {
    border: 1px dashed #cfd8e6;
    border-radius: 10px;
    padding: 42px 16px;
    text-align: center;
  }

  .empty-state h3 {
    margin: 0 0 8px;
  }

  .empty-state p {
    margin: 0;
    color: #66758a;
  }

  @media (max-width: 1200px) {
    .topbar,
    .scout-workspace {
      grid-template-columns: 1fr;
    }

    .workspace-tabs,
    .topbar-actions {
      justify-self: start;
    }

    .side-panel {
      position: static;
      height: auto;
    }
  }

  @media (max-width: 760px) {
    .topbar,
    .scout-workspace,
    .setup-workspace,
    .reports-workspace {
      padding-left: 14px;
      padding-right: 14px;
    }

    .setup-grid,
    .filters-grid,
    .detail-grid {
      grid-template-columns: 1fr;
    }

    .report-header,
    .section-heading {
      align-items: flex-start;
      flex-direction: column;
    }

    .button-row,
    .setup-footer,
    .topbar-actions {
      flex-wrap: wrap;
      justify-content: flex-start;
    }

    .candidate-top {
      align-items: flex-start;
    }

    .report-run-heading {
      align-items: flex-start;
      flex-direction: column;
    }

    .link-evidence-list a {
      max-width: 100%;
    }
  }
</style>

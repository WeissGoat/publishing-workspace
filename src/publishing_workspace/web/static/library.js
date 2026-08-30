(function () {
  "use strict";

  const state = {
    filters: {
      import_id: "",
      import_ids: [],
      text: "",
      artist: "",
      character: "",
      action_group: "",
      action: "",
      facets: {},
      tags: new Set(),
      favorite_mode: "all", // "all" | "favorited" | "unfavorited"
      posted_mode: "all",   // "all" | "posted" | "unposted"
      sort_by: localStorage.getItem("library_sort_by") || "order_asc",
    },
    allImports: [],
    snapshotSearchQuery: "",
    availableTags: [],
    offset: 0,
    limit: 60,
    hasMore: true,
    loadingPage: false,
    requestToken: 0,
    loadedAssets: new Map(),
    selectedAssetIds: new Set(),
    focusedAssetId: null,
    lastSelectedAssetId: null,
    isBatchMode: false,
    datasetAssets: [],
    datasetImportId: null,
    cardElements: new Map(),

    currentSubmission: {
      task_id: null,
      title: "",
      source_import_id: null,
      revision: 1,
      sets: { all: [], post: [], cover: [] },
      pixiv: {
        title: "",
        caption: "",
        tags: [],
        suggested_tags: [],
        r18: true,
        allow_tag_edit: true,
        crop_x: null,
        crop_y: null,
      },
      currentSetTab: "all",
      legacyInlineSource: null, // { plan_id, entry_id, plan_revision }
    },

    tagSuggestions: {
      preset: [],
      character: [],
      action: [],
      pixiv: [],
    },

    historicalSubmissions: [],
    availableFacets: {},
    expandedFacetCategories: new Set(["clothing"]),
    activeExportJob: null,
    exportPollTimer: null,
    lightbox: {
      activeAssetId: null,
      list: [],
      index: 0,
      mode: "view",
      isExported: false,
      exportItem: null,
      exportTabName: null,
    },
  };

  const FACET_CONFIG = [
    { key: "clothing", label: "服装", icon: "👗" },
    { key: "phase", label: "阶段", icon: "⏳" },
    { key: "subtype", label: "子分类", icon: "📂" },
    { key: "cast", label: "角色类型", icon: "👥" },
    { key: "pose", label: "体态姿势", icon: "🧘" },
    { key: "environment", label: "环境背景", icon: "🏞️" },
    { key: "tone", label: "基调风格", icon: "🎨" },
    { key: "flags", label: "标记", icon: "🚩" },
    { key: "species", label: "种族", icon: "🐾" },
    { key: "domain", label: "领域", icon: "🌐" },
  ];

  const FACET_LABELS = Object.fromEntries(FACET_CONFIG.map((f) => [f.key, f.label]));

  const ROLE_LABELS = {
    text: "关键词",
    artist: "画风",
    character: "角色",
    action_group: "动作组",
    action: "动作",
  };

  const elements = {
    notice: document.getElementById("notice"),
    refreshAllBtn: document.getElementById("refresh-all"),
    resetFiltersBtn: document.getElementById("reset-filters"),
    importSelect: document.getElementById("import-select"),
    snapshotPicker: document.getElementById("snapshot-picker"),
    snapshotPickerTrigger: document.getElementById("snapshot-picker-trigger"),
    snapshotPickerValue: document.getElementById("snapshot-picker-value"),
    snapshotPickerClear: document.getElementById("snapshot-picker-clear"),
    snapshotPickerDropdown: document.getElementById("snapshot-picker-dropdown"),
    snapshotPickerSearch: document.getElementById("snapshot-picker-search"),
    snapshotPickerList: document.getElementById("snapshot-picker-list"),
    snapshotSelectAll: document.getElementById("snapshot-select-all"),
    snapshotSelectNone: document.getElementById("snapshot-select-none"),
    snapshotSelectGlobal: document.getElementById("snapshot-select-global"),
    snapshotCountHint: document.getElementById("snapshot-count-hint"),

    textFilter: document.getElementById("text-filter"),
    searchAssetsBtn: document.getElementById("search-assets-btn"),
    artistFilter: document.getElementById("artist-filter"),
    characterFilter: document.getElementById("character-filter"),
    groupFilter: document.getElementById("group-filter"),
    actionFilter: document.getElementById("action-filter"),

    activeFilterChips: document.getElementById("active-filter-chips"),
    activeChipsList: document.getElementById("active-chips-list"),
    clearAllChips: document.getElementById("clear-all-chips"),

    quickFilterSection: document.querySelector(".quick-filter-section"),
    tagFilterSection: document.getElementById("tag-filter-section"),
    clearTagFiltersBtn: document.getElementById("clear-tag-filters"),
    tagChipsContainer: document.getElementById("tag-chips-container"),
    facetAccordion: document.getElementById("facet-accordion"),
    clearFacetsBtn: document.getElementById("clear-facets-btn"),

    assetCountBadge: document.getElementById("asset-count-badge"),
    cardSizeSlider: document.getElementById("card-size-slider"),
    cardSizeVal: document.getElementById("card-size-val"),
    sortSelect: document.getElementById("sort-select"),
    btnBatchToggle: document.getElementById("btn-batch-toggle"),
    selectedCountBadge: document.getElementById("selected-count-badge"),
    selectAllVisibleBtn: document.getElementById("select-all-visible-btn"),
    clearSelectionBtn: document.getElementById("clear-selection-btn"),
    addToSetBtn: document.getElementById("add-to-set-btn"),
    galleryBatchBar: document.getElementById("gallery-batch-bar"),
    batchSelectedCount: document.getElementById("batch-selected-count"),
    batchBtnFav: document.getElementById("batch-btn-fav"),
    batchBtnUnfav: document.getElementById("batch-btn-unfav"),
    batchBtnPost: document.getElementById("batch-btn-post"),
    batchBtnUnpost: document.getElementById("batch-btn-unpost"),
    batchBtnTag: document.getElementById("batch-btn-tag"),
    batchBtnAddSet: document.getElementById("batch-btn-add-set"),
    batchBtnCopyPaths: document.getElementById("batch-btn-copy-paths"),
    batchBtnClear: document.getElementById("batch-btn-clear"),
    assetWaterfall: document.getElementById("asset-waterfall"),
    scrollSentinel: document.getElementById("scroll-sentinel"),
    loadingSpinner: document.getElementById("loading-spinner"),
    endOfResults: document.getElementById("end-of-results"),

    importProgressWrap: document.getElementById("import-progress-wrap"),
    importProgressStatus: document.getElementById("import-progress-status"),
    importProgressText: document.getElementById("import-progress-text"),
    importProgressFill: document.getElementById("import-progress-fill"),
    emptySnapshotGuide: document.getElementById("empty-snapshot-guide"),

    galleryProgressBanner: document.getElementById("gallery-progress-banner"),
    galleryProgressTitle: document.getElementById("gallery-progress-title"),
    galleryProgressCount: document.getElementById("gallery-progress-count"),
    galleryProgressFill: document.getElementById("gallery-progress-fill"),

    submissionEditorTitle: document.getElementById("submission-editor-title"),
    newSubmissionBtn: document.getElementById("new-submission-btn"),
    historySubmissionSelect: document.getElementById("history-submission-select"),
    legacyConvertBanner: document.getElementById("legacy-convert-banner"),
    submissionForm: document.getElementById("submission-form"),
    submissionTitle: document.getElementById("submission-title"),
    submissionDate: document.getElementById("submission-date"),
    submissionTime: document.getElementById("submission-time"),
    clearScheduleBtn: document.getElementById("clear-schedule-btn"),

    // Pixiv 投稿设定
    pixivAutoBtn: document.getElementById("pixiv-auto-btn"),
    pixivCropResetBtn: document.getElementById("pixiv-crop-reset-btn"),
    pixivThumbPreviewBox: document.getElementById("pixiv-thumb-preview-box"),
    pixivThumbPreviewImg: document.getElementById("pixiv-thumb-preview-img"),
    pixivThumbEmptyBox: document.getElementById("pixiv-thumb-empty-box"),
    pixivThumbOrientationBadge: document.getElementById("pixiv-thumb-orientation-badge"),
    pixivThumbDimensions: document.getElementById("pixiv-thumb-dimensions"),
    pixivThumbCropStatus: document.getElementById("pixiv-thumb-crop-status"),
    openPixivCropBtn: document.getElementById("open-pixiv-crop-btn"),
    pixivCaption: document.getElementById("pixiv-caption"),
    pixivR18: document.getElementById("pixiv-r18"),
    pixivAllowTagEdit: document.getElementById("pixiv-allow-tag-edit"),
    pixivTagsCount: document.getElementById("pixiv-tags-count"),
    clearPixivTagsBtn: document.getElementById("clear-pixiv-tags-btn"),
    pixivSelectedTags: document.getElementById("pixiv-selected-tags"),
    pixivCustomTagInput: document.getElementById("pixiv-custom-tag-input"),
    addPixivCustomTagBtn: document.getElementById("add-pixiv-custom-tag-btn"),
    recommendPresetTags: document.getElementById("recommend-preset-tags"),
    syncPixivPastTagsBtn: document.getElementById("sync-pixiv-past-tags-btn"),
    recommendCharTags: document.getElementById("recommend-char-tags"),
    recommendActionTags: document.getElementById("recommend-action-tags"),
    fetchPixivOnlineTagsBtn: document.getElementById("fetch-pixiv-online-tags-btn"),
    recommendPixivOnlineTags: document.getElementById("recommend-pixiv-online-tags"),
    publishToPixivBtn: document.getElementById("publish-to-pixiv-btn"),
    republishToPixivBtn: document.getElementById("republish-to-pixiv-btn"),
    schedulePixivBtn: document.getElementById("schedule-pixiv-btn"),
    scheduleAllowDelayCheckbox: document.getElementById("schedule-allow-delay-checkbox"),
    scheduleDelayMinutesInput: document.getElementById("schedule-delay-minutes-input"),
    pixivPublishStatusBox: document.getElementById("pixiv-publish-status-box"),
    pixivScheduleStatusBox: document.getElementById("pixiv-schedule-status-box"),

    // Pixiv 裁剪 Modal
    pixivCropDialog: document.getElementById("pixiv-crop-dialog"),
    closeCropDialogBtn: document.getElementById("close-crop-dialog-btn"),
    cropModalSubtitle: document.getElementById("crop-modal-subtitle"),
    cropStage: document.getElementById("crop-stage"),
    cropViewportFrame: document.getElementById("crop-viewport-frame"),
    cropStageImg: document.getElementById("crop-stage-img"),
    cropDragHintText: document.getElementById("crop-drag-hint-text"),
    cropSliderStartLabel: document.getElementById("crop-slider-start-label"),
    cropSliderEndLabel: document.getElementById("crop-slider-end-label"),
    cropRangeSlider: document.getElementById("crop-range-slider"),
    cropLivePreviewLg: document.getElementById("crop-live-preview-lg"),
    cropLivePreviewSm: document.getElementById("crop-live-preview-sm"),
    cropPresetStartBtn: document.getElementById("crop-preset-start-btn"),
    cropPresetCenterBtn: document.getElementById("crop-preset-center-btn"),
    cropPresetEndBtn: document.getElementById("crop-preset-end-btn"),
    cropCoordsText: document.getElementById("crop-coords-text"),
    cropApplyBtn: document.getElementById("crop-apply-btn"),
    cropCancelBtn: document.getElementById("crop-cancel-btn"),

    submissionTaskBadge: document.getElementById("submission-task-badge"),
    submissionRevBadge: document.getElementById("submission-rev-badge"),
    submissionPixivBadge: document.getElementById("submission-pixiv-badge"),
    tabAll: document.getElementById("tab-all"),
    tabPost: document.getElementById("tab-post"),
    tabCover: document.getElementById("tab-cover"),
    badgeCountAll: document.getElementById("badge-count-all"),
    badgeCountPost: document.getElementById("badge-count-post"),
    badgeCountCover: document.getElementById("badge-count-cover"),
    clearCurrentSetBtn: document.getElementById("clear-current-set-btn"),
    setItemsContainer: document.getElementById("set-items-container"),
    saveSubmissionBtn: document.getElementById("save-submission-btn"),
    deleteSubmissionBtn: document.getElementById("delete-submission-btn"),

    startExportBtn: document.getElementById("start-export-btn"),
    exportMosaicToggle: document.getElementById("export-mosaic-toggle"),
    exportMosaicParams: document.getElementById("export-mosaic-params"),
    exportMosaicPixelSize: document.getElementById("export-mosaic-pixel-size"),
    exportMosaicPixelVal: document.getElementById("export-mosaic-pixel-val"),
    exportProgressBox: document.getElementById("export-progress-box"),
    progressBarFill: document.getElementById("progress-bar-fill"),
    progressPhase: document.getElementById("progress-phase"),
    progressPercent: document.getElementById("progress-percent"),
    progressFile: document.getElementById("progress-file"),
    exportCompletedBox: document.getElementById("export-completed-box"),
    exportTimeLabel: document.getElementById("export-time-label"),
    pipelineOpsList: document.getElementById("pipeline-ops-list"),
    exportArchivesContainer: document.getElementById("export-archives-container"),
    exportTabsContainer: document.getElementById("export-tabs-container"),
    exportedThumbsGrid: document.getElementById("exported-thumbs-grid"),
    openExportDirBtn: document.getElementById("open-export-dir-btn"),
    exportErrorBox: document.getElementById("export-error-box"),
    exportErrorText: document.getElementById("export-error-text"),

    // Pro Lightbox Viewer
    previewDialog: document.getElementById("preview-dialog"),
    lightboxContainer: document.querySelector(".lightbox-container"),
    lightboxModeTabs: document.getElementById("lightbox-mode-tabs"),
    lightboxImageArea: document.getElementById("lightbox-image-area"),
    lightboxEditorArea: document.getElementById("lightbox-editor-area"),

    previewImage: document.getElementById("preview-image"),
    closePreview: document.getElementById("close-preview"),
    lightboxFilename: document.getElementById("lightbox-filename"),
    lightboxFilepath: document.getElementById("lightbox-filepath"),
    lightboxCounter: document.getElementById("lightbox-counter"),

    // Inpaint UI
    lightboxInpaintArea: document.getElementById("lightbox-inpaint-area"),
    lightboxInpaintSidebar: document.getElementById("lightbox-inpaint-sidebar"),
    lightboxViewSidebar: document.getElementById("lightbox-view-sidebar"),
    inpaintTabMask: document.getElementById("inpaint-tab-mask"),
    inpaintTabCompare: document.getElementById("inpaint-tab-compare"),
    inpaintViewModeTabs: document.getElementById("inpaint-view-mode-tabs"),
    inpaintMaskTools: document.getElementById("inpaint-mask-tools"),
    inpaintCompareTools: document.getElementById("inpaint-compare-tools"),
    inpaintCanvasWrap: document.getElementById("inpaint-canvas-wrap"),
    inpaintCanvasBg: document.getElementById("inpaint-canvas-bg"),
    inpaintCanvasMask: document.getElementById("inpaint-canvas-mask"),
    inpaintCanvasCursor: document.getElementById("inpaint-canvas-cursor"),
    inpaintBrushSize: document.getElementById("inpaint-brush-size"),
    inpaintBrushSizeVal: document.getElementById("inpaint-brush-size-val"),
    inpaintUndoBtn: document.getElementById("inpaint-undo-btn"),
    inpaintRedoBtn: document.getElementById("inpaint-redo-btn"),
    inpaintClearBtn: document.getElementById("inpaint-clear-btn"),
    inpaintToggleDiffBtn: document.getElementById("inpaint-toggle-diff-btn"),
    inpaintResetSliderBtn: document.getElementById("inpaint-reset-slider-btn"),
    inpaintSwitchToMaskBtn: document.getElementById("inpaint-switch-to-mask-btn"),
    inpaintCompareWrap: document.getElementById("inpaint-compare-wrap"),
    inpaintCompareInner: document.getElementById("inpaint-compare-inner"),
    inpaintCompareBefore: document.getElementById("inpaint-compare-before"),
    inpaintCompareAfterWrap: document.getElementById("inpaint-compare-after-wrap"),
    inpaintCompareAfter: document.getElementById("inpaint-compare-after"),
    inpaintCompareHandle: document.getElementById("inpaint-compare-handle"),
    inpaintPromptInput: document.getElementById("inpaint-prompt-input"),
    inpaintNegPromptInput: document.getElementById("inpaint-neg-prompt-input"),
    inpaintStrengthSlider: document.getElementById("inpaint-strength-slider"),
    inpaintStrengthVal: document.getElementById("inpaint-strength-val"),
    inpaintCountGroup: document.getElementById("inpaint-count-group"),
    inpaintGenerateBtn: document.getElementById("inpaint-generate-btn"),
    inpaintSpinner: document.getElementById("inpaint-spinner"),
    inpaintGenerateBtnText: document.getElementById("inpaint-generate-btn-text"),
    inpaintProgressBox: document.getElementById("inpaint-progress-box"),
    inpaintProgressText: document.getElementById("inpaint-progress-text"),
    inpaintProgressFill: document.getElementById("inpaint-progress-fill"),
    inpaintProgressHint: document.getElementById("inpaint-progress-hint"),
    inpaintResultsSection: document.getElementById("inpaint-results-section"),
    inpaintCandidatesCount: document.getElementById("inpaint-candidates-count"),
    inpaintBatchCountBadge: document.getElementById("inpaint-batch-count-badge"),
    inpaintBatchesContainer: document.getElementById("inpaint-batches-container"),
    inpaintStickyFooter: document.getElementById("inpaint-sticky-footer"),
    inpaintApplyBtn: document.getElementById("inpaint-apply-btn"),
    inpaintDiscardBtn: document.getElementById("inpaint-discard-btn"),
    lightboxPrevBtn: document.getElementById("lightbox-prev-btn"),
    lightboxNextBtn: document.getElementById("lightbox-next-btn"),
    lightboxFavoriteBtn: document.getElementById("lightbox-favorite-btn"),
    lightboxFavLabel: document.getElementById("lightbox-fav-label"),
    lightboxPostedBtn: document.getElementById("lightbox-posted-btn"),
    lightboxPostedLabel: document.getElementById("lightbox-posted-label"),
    lightboxRevealBtn: document.getElementById("lightbox-reveal-btn"),

    lbMetaDimensions: document.getElementById("lb-meta-dimensions"),
    lbMetaSize: document.getElementById("lb-meta-size"),
    lbMetaMtime: document.getElementById("lb-meta-mtime"),
    lbMetaSeed: document.getElementById("lb-meta-seed"),
    lbMetaModel: document.getElementById("lb-meta-model"),
    lbMetaSampler: document.getElementById("lb-meta-sampler"),
    lbMetaSteps: document.getElementById("lb-meta-steps"),
    lbMetaScale: document.getElementById("lb-meta-scale"),
    lbMetaNoise: document.getElementById("lb-meta-noise"),

    lbNodeArtist: document.getElementById("lb-node-artist"),
    lbNodeCharacter: document.getElementById("lb-node-character"),
    lbNodeGroup: document.getElementById("lb-node-group"),
    lbNodeAction: document.getElementById("lb-node-action"),

    lbTagsSection: document.getElementById("lb-tags-section"),
    lbTagsList: document.getElementById("lb-tags-list"),

    lbFacetsSection: document.getElementById("lb-facets-section"),
    lbFacetsList: document.getElementById("lb-facets-list"),

    lbPromptBox: document.getElementById("lb-prompt-box"),
    lbCopyPrompt: document.getElementById("lb-copy-prompt"),
    lbNegativeBox: document.getElementById("lb-negative-box"),
    lbCopyNeg: document.getElementById("lb-copy-neg"),
    lbRawParameters: document.getElementById("lb-raw-parameters"),

    lbSnapshotsSection: document.getElementById("lb-snapshots-section"),
    lbSnapshotsCount: document.getElementById("lb-snapshots-count"),
    lbSnapshotsList: document.getElementById("lb-snapshots-list"),

    lightboxBackBtn: document.getElementById("lightbox-back-btn"),
    lightboxBackLabel: document.getElementById("lightbox-back-label"),
    lbRelatedSection: document.getElementById("lb-related-section"),
    lbRelatedTotalCount: document.getElementById("lb-related-total-count"),
    lbRelatedViewToggles: document.getElementById("lb-related-view-toggles"),
    lbRelatedTabs: document.getElementById("lb-related-tabs"),
    lbRelBadgeBatch: document.getElementById("lb-rel-badge-batch"),
    lbRelBadgeSeed: document.getElementById("lb-rel-badge-seed"),
    lbRelBadgeAdj: document.getElementById("lb-rel-badge-adj"),
    lbRelatedList: document.getElementById("lb-related-list"),
    lbRelatedHint: document.getElementById("lb-related-hint"),
    lbHoverPreviewPopover: document.getElementById("lb-hover-preview-popover"),
  };

  let noticeTimer = null;
  function showNotice(message, type = "info") {
    clearTimeout(noticeTimer);
    let noticeEl = elements.notice;
    if (elements.previewDialog && elements.previewDialog.open) {
      let dlgNotice = elements.previewDialog.querySelector(".dialog-toast");
      if (!dlgNotice) {
        dlgNotice = document.createElement("div");
        dlgNotice.className = "notice dialog-toast";
        elements.previewDialog.appendChild(dlgNotice);
      }
      noticeEl = dlgNotice;
    }
    if (noticeEl) {
      noticeEl.textContent = message;
      noticeEl.className = `notice ${type} dialog-toast`;
    }
    noticeTimer = setTimeout(() => {
      clearNotice();
    }, 3500);
  }

  function clearNotice() {
    clearTimeout(noticeTimer);
    if (elements.notice) {
      elements.notice.textContent = "";
      elements.notice.className = "notice";
    }
    if (elements.previewDialog) {
      const dlgNotice = elements.previewDialog.querySelector(".dialog-toast");
      if (dlgNotice) {
        dlgNotice.textContent = "";
        dlgNotice.className = "notice dialog-toast";
      }
    }
  }

  function escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ================= 收藏 (Favorites) localStorage 持久化 =================

  const FAVORITES_KEY_PREFIX = "pw_favorites_";

  function hasSnapshotSelection() {
    return Array.isArray(state.filters.import_ids) && state.filters.import_ids.length > 0;
  }

  function getSelectedImportKey() {
    if (!hasSnapshotSelection()) return "";
    if (state.filters.import_ids.includes("__all__")) return "__all__";
    return [...state.filters.import_ids].sort().join(",");
  }

  function getFavoritesSet(importKey) {
    const key = typeof importKey === "string" ? importKey : getSelectedImportKey();
    if (!key) return new Set();
    if (key === "__all__") {
      const combined = new Set();
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(FAVORITES_KEY_PREFIX)) {
            const raw = localStorage.getItem(k);
            if (raw) {
              const arr = JSON.parse(raw);
              for (const id of arr) combined.add(id);
            }
          }
        }
      } catch {}
      return combined;
    }
    if (key.includes(",")) {
      const combined = new Set();
      for (const singleId of key.split(",")) {
        if (!singleId) continue;
        try {
          const raw = localStorage.getItem(FAVORITES_KEY_PREFIX + singleId);
          if (raw) {
            const arr = JSON.parse(raw);
            for (const id of arr) combined.add(id);
          }
        } catch {}
      }
      return combined;
    }
    try {
      const raw = localStorage.getItem(FAVORITES_KEY_PREFIX + key);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  }

  function saveFavoritesSet(importKey, favSet) {
    const key = typeof importKey === "string" ? importKey : getSelectedImportKey();
    if (!key) return;
    const storeKey = key === "__all__" ? `${FAVORITES_KEY_PREFIX}global` : FAVORITES_KEY_PREFIX + key;
    localStorage.setItem(storeKey, JSON.stringify([...favSet]));
  }

  async function syncFavoritesFromServer(importKey) {
    const key = typeof importKey === "string" ? importKey : getSelectedImportKey();
    if (!key) return;
    try {
      let url = "/api/favorites";
      if (key !== "__all__") {
        if (key.includes(",")) {
          url = `/api/favorites?import_ids=${encodeURIComponent(key)}`;
        } else {
          url = `/api/favorites?import_id=${encodeURIComponent(key)}`;
        }
      }
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.favorites) && data.favorites.length > 0) {
          const favSet = getFavoritesSet(key);
          let changed = false;
          for (const id of data.favorites) {
            if (!favSet.has(id)) {
              favSet.add(id);
              changed = true;
            }
          }
          if (changed) {
            saveFavoritesSet(key, favSet);
          }
        }
      }
    } catch {}
  }

  function isAssetFavorited(assetId) {
    return getFavoritesSet().has(assetId);
  }

  function toggleFavorite(assetId) {
    const importKey = getSelectedImportKey();
    if (!importKey) return false;
    const favSet = getFavoritesSet(importKey);
    const nowFav = !favSet.has(assetId);
    if (nowFav) {
      favSet.add(assetId);
    } else {
      favSet.delete(assetId);
    }
    saveFavoritesSet(importKey, favSet);

    // 异步同步至 Catalog 持久化
    fetch("/api/favorites/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ asset_id: assetId, import_id: state.filters.import_id || null, favorited: nowFav }),
    }).catch(() => {});

    return nowFav;
  }

  // ================= 快照独立筛选记忆与持久化 =================

  const SNAPSHOT_FILTERS_KEY_PREFIX = "pw_snapshot_filters_";
  const LAST_SELECTED_IMPORTS_KEY = "pw_last_selected_imports";
  const LAST_SELECTED_IMPORT_KEY = "pw_last_selected_import";

  function getDefaultFilters(importKey = "") {
    const parsedIds = importKey ? (importKey.includes(",") ? importKey.split(",") : [importKey]) : [];
    return {
      import_id: parsedIds.includes("__all__") ? "__all__" : (parsedIds[0] || ""),
      import_ids: parsedIds,
      text: "",
      artist: "",
      character: "",
      action_group: "",
      action: "",
      facets: {},
      tags: new Set(),
      favorite_mode: "all",
      posted_mode: "all",
      sort_by: localStorage.getItem("library_sort_by") || "order_asc",
    };
  }

  function getSnapshotFilters(importKey) {
    if (!importKey) return getDefaultFilters("");
    try {
      const raw = localStorage.getItem(SNAPSHOT_FILTERS_KEY_PREFIX + importKey);
      if (raw) {
        const saved = JSON.parse(raw);
        const parsedIds = importKey.includes(",") ? importKey.split(",") : [importKey];
        return {
          ...getDefaultFilters(importKey),
          ...saved,
          import_id: parsedIds.includes("__all__") ? "__all__" : (parsedIds[0] || ""),
          import_ids: parsedIds,
          facets: saved.facets || {},
          tags: saved.tags && Array.isArray(saved.tags) ? new Set(saved.tags) : new Set(),
          sort_by: saved.sort_by || localStorage.getItem("library_sort_by") || "order_asc",
        };
      }
    } catch {}
    return getDefaultFilters(importKey);
  }

  function saveSnapshotFilters(importKey, filters) {
    if (!importKey) return;
    try {
      const toSave = {
        text: filters.text || "",
        artist: filters.artist || "",
        character: filters.character || "",
        action_group: filters.action_group || "",
        action: filters.action || "",
        facets: filters.facets || {},
        tags: filters.tags ? Array.from(filters.tags) : [],
        favorite_mode: filters.favorite_mode || "all",
        posted_mode: filters.posted_mode || "all",
        sort_by: filters.sort_by || "order_asc",
      };
      localStorage.setItem(SNAPSHOT_FILTERS_KEY_PREFIX + importKey, JSON.stringify(toSave));
    } catch {}
  }

  function syncFilterInputsFromState() {
    if (elements.textFilter) elements.textFilter.value = state.filters.text || "";
    if (elements.artistFilter) elements.artistFilter.value = state.filters.artist || "";
    if (elements.characterFilter) elements.characterFilter.value = state.filters.character || "";
    if (elements.groupFilter) elements.groupFilter.value = state.filters.action_group || "";
    if (elements.actionFilter) elements.actionFilter.value = state.filters.action || "";
    if (elements.sortSelect) elements.sortSelect.value = state.filters.sort_by || "order_asc";

    document.querySelectorAll(".node-picker").forEach((picker) => {
      const input = picker.querySelector(".field-control");
      const clearBtn = picker.querySelector(".node-clear");
      if (input && clearBtn) {
        clearBtn.hidden = !input.value.trim();
      }
    });

    syncQuickFilterButtons();
    renderFacetAccordion();
    renderTagChips();
    renderActiveChips();
  }

  // ================= 现代快照多选选择器 (Snapshot Picker) =================

  function formatShortTime(isoStr) {
    if (!isoStr) return "";
    try {
      const normalized = String(isoStr).replace(" ", "T");
      const d = new Date(normalized);
      if (isNaN(d.getTime())) return "";
      const now = new Date();
      const isToday = d.toDateString() === now.toDateString();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const hours = String(d.getHours()).padStart(2, "0");
      const minutes = String(d.getMinutes()).padStart(2, "0");
      if (isToday) {
        return `今天 ${hours}:${minutes}`;
      }
      return `${month}-${day} ${hours}:${minutes}`;
    } catch {
      return "";
    }
  }

  function updateSnapshotTriggerDisplay() {
    if (!elements.snapshotPickerValue) return;
    const selected = state.filters.import_ids || [];

    if (!selected.length) {
      elements.snapshotPickerValue.innerHTML = '<span class="snapshot-picker-placeholder">-- 请选择导入快照 --</span>';
      if (elements.snapshotPickerClear) elements.snapshotPickerClear.classList.add("hidden");
      if (elements.snapshotCountHint) elements.snapshotCountHint.textContent = "";
      return;
    }

    if (elements.snapshotPickerClear) elements.snapshotPickerClear.classList.remove("hidden");

    if (selected.includes("__all__")) {
      elements.snapshotPickerValue.innerHTML = '<span class="snapshot-picker-badge snapshot-picker-badge-global">🌟 全部导入素材 (全量浏览)</span>';
      if (elements.snapshotCountHint) elements.snapshotCountHint.textContent = "全量浏览";
      return;
    }

    if (selected.length === 1) {
      const item = state.allImports.find((imp) => imp.import_id === selected[0]);
      if (item) {
        const ref = item.source_ref || "";
        const name = ref.split(/[/\\]/).filter(Boolean).pop() || item.import_id;
        const tagsStr = item.tags && item.tags.length > 0 ? ` [${item.tags.join(",")}]` : "";
        const countStr = item.total_items ? ` (${item.total_items}张)` : "";
        elements.snapshotPickerValue.innerHTML = `<span class="snapshot-picker-badge">📁 ${escapeHtml(name)}${escapeHtml(tagsStr)}${escapeHtml(countStr)}</span>`;
      } else {
        elements.snapshotPickerValue.innerHTML = `<span class="snapshot-picker-badge">📁 ${escapeHtml(selected[0])}</span>`;
      }
      if (elements.snapshotCountHint) elements.snapshotCountHint.textContent = "1 个快照";
      return;
    }

    // 多选展示
    let totalImages = 0;
    for (const id of selected) {
      const item = state.allImports.find((imp) => imp.import_id === id);
      if (item && item.total_items) totalImages += item.total_items;
    }
    const totalCountStr = totalImages > 0 ? `共 ${totalImages.toLocaleString()} 张` : "";
    elements.snapshotPickerValue.innerHTML = `
      <span class="snapshot-picker-badge">📁 已选 ${selected.length} 个快照</span>
      ${totalCountStr ? `<span class="snapshot-picker-badge snapshot-picker-badge-count">${totalCountStr}</span>` : ""}
    `;
    if (elements.snapshotCountHint) elements.snapshotCountHint.textContent = `已选 ${selected.length} 个快照`;
  }

  function renderSnapshotList() {
    if (!elements.snapshotPickerList) return;
    elements.snapshotPickerList.innerHTML = "";

    const query = (state.snapshotSearchQuery || "").trim().toLowerCase();
    const selectedSet = new Set(state.filters.import_ids || []);
    const isGlobal = selectedSet.has("__all__");

    const filtered = state.allImports.filter((item) => {
      if (!query) return true;
      const ref = (item.source_ref || "").toLowerCase();
      const impId = (item.import_id || "").toLowerCase();
      const tags = (item.tags || []).join(" ").toLowerCase();
      return ref.includes(query) || impId.includes(query) || tags.includes(query);
    });

    if (filtered.length === 0) {
      elements.snapshotPickerList.innerHTML = '<div class="snapshot-empty-search">未找到匹配的快照</div>';
      return;
    }

    for (const item of filtered) {
      const isChecked = isGlobal || selectedSet.has(item.import_id);
      const row = document.createElement("div");
      row.className = `snapshot-picker-item ${isChecked ? "selected" : ""}`;
      row.dataset.importId = item.import_id;

      const ref = item.source_ref || "";
      const name = ref.split(/[/\\]/).filter(Boolean).pop() || item.import_id;
      const dateStr = item.created_at ? formatShortTime(item.created_at) : "";
      const importCountStr = item.import_count && item.import_count > 1 ? ` (归并${item.import_count}次)` : "";

      const tagsHtml = (item.tags && item.tags.length > 0)
        ? `<div class="snapshot-picker-item-tags">${item.tags.map((t) => `<span class="snapshot-tag-pill">${escapeHtml(t)}</span>`).join("")}</div>`
        : "";

      row.innerHTML = `
        <input type="checkbox" class="snapshot-picker-checkbox" ${isChecked ? "checked" : ""}>
        <div class="snapshot-picker-item-content">
          <div class="snapshot-picker-item-main">
            <span class="snapshot-picker-item-title" title="${escapeHtml(ref || item.import_id)}">📁 ${escapeHtml(name)}</span>
            ${tagsHtml}
          </div>
          <div class="snapshot-picker-item-meta">
            <span class="snapshot-count-pill">${item.total_items ? `${item.total_items}张` : ""}${importCountStr}</span>
            ${dateStr ? `<span class="snapshot-date-pill">· ${dateStr}</span>` : ""}
          </div>
        </div>
        <button type="button" class="snapshot-only-btn" title="仅单选此快照并浏览">仅选此项</button>
      `;

      // 仅选此项按钮
      const onlyBtn = row.querySelector(".snapshot-only-btn");
      if (onlyBtn) {
        onlyBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          switchSnapshot([item.import_id]);
          closeSnapshotDropdown();
        });
      }

      // 点击行 / 复选框：多选切换
      row.addEventListener("click", (e) => {
        if (e.target.closest(".snapshot-only-btn")) return;
        const currentSelected = new Set(
          (state.filters.import_ids || []).filter((id) => id !== "__all__")
        );
        if (currentSelected.has(item.import_id)) {
          currentSelected.delete(item.import_id);
        } else {
          currentSelected.add(item.import_id);
        }
        switchSnapshot([...currentSelected]);
      });

      elements.snapshotPickerList.appendChild(row);
    }
  }

  function openSnapshotDropdown() {
    if (!elements.snapshotPickerDropdown) return;
    elements.snapshotPickerDropdown.classList.remove("hidden");
    if (elements.snapshotPickerTrigger) {
      elements.snapshotPickerTrigger.classList.add("active");
      elements.snapshotPickerTrigger.setAttribute("aria-expanded", "true");
    }
    renderSnapshotList();
    if (elements.snapshotPickerSearch) {
      elements.snapshotPickerSearch.focus();
    }
  }

  function closeSnapshotDropdown() {
    if (!elements.snapshotPickerDropdown) return;
    elements.snapshotPickerDropdown.classList.add("hidden");
    if (elements.snapshotPickerTrigger) {
      elements.snapshotPickerTrigger.classList.remove("active");
      elements.snapshotPickerTrigger.setAttribute("aria-expanded", "false");
    }
  }

  async function loadImportsList() {
    try {
      const res = await fetch("/api/imports");
      if (res.ok) {
        const data = await res.json();
        state.allImports = Array.isArray(data) ? data : [];

        // 兼容更新原生 select options
        if (elements.importSelect) {
          elements.importSelect.innerHTML = `
            <option value="">-- 请选择导入快照 --</option>
            <option value="__all__">🌟 全部导入素材 (全量浏览)</option>
          `;
          for (const item of state.allImports) {
            const opt = document.createElement("option");
            opt.value = item.import_id;
            const ref = item.source_ref || "";
            const name = ref.split(/[/\\]/).filter(Boolean).pop() || item.import_id;
            opt.textContent = `📁 ${name} (${item.total_items || 0}张)`;
            elements.importSelect.appendChild(opt);
          }
        }

        renderSnapshotList();

        // 默认自动恢复选中上次打开的快照（优先多选持久化，回退单选）
        let restoredIds = null;
        try {
          const rawMulti = localStorage.getItem(LAST_SELECTED_IMPORTS_KEY);
          if (rawMulti) {
            const parsed = JSON.parse(rawMulti);
            if (Array.isArray(parsed) && parsed.length > 0) {
              restoredIds = parsed;
            }
          }
        } catch {}

        if (!restoredIds) {
          const lastSingle = localStorage.getItem(LAST_SELECTED_IMPORT_KEY);
          if (lastSingle) {
            restoredIds = [lastSingle];
          }
        }

        if (restoredIds && restoredIds.length > 0) {
          await switchSnapshot(restoredIds);
        } else if (!hasSnapshotSelection()) {
          await switchSnapshot([]);
        }
      }
    } catch (err) {
      console.warn("加载导入列表失败", err);
      if (!hasSnapshotSelection()) {
        await switchSnapshot([]);
      }
    }
  }

  // ================= 真正服务端驱动的按需流式瀑布流 =================

  function updateGalleryProgress(loading = false) {
    if (!elements.galleryProgressBanner) return;
    const total = state.total || 0;
    const loaded = state.loadedAssets.size;

    if (!hasSnapshotSelection() || total === 0) {
      elements.galleryProgressBanner.classList.add("hidden");
      return;
    }

    elements.galleryProgressBanner.classList.remove("hidden");
    const percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;

    if (elements.galleryProgressFill) {
      elements.galleryProgressFill.style.width = `${Math.max(1, percent)}%`;
    }

    if (elements.galleryProgressCount) {
      elements.galleryProgressCount.textContent = `已呈现 ${loaded.toLocaleString()} / ${total.toLocaleString()} (${percent}%)`;
    }

    if (!state.hasMore || loaded >= total) {
      elements.galleryProgressBanner.classList.add("completed");
      if (elements.galleryProgressTitle) {
        elements.galleryProgressTitle.textContent = `已全部载入 (共 ${total.toLocaleString()} 项)`;
      }
    } else {
      elements.galleryProgressBanner.classList.remove("completed");
      if (elements.galleryProgressTitle) {
        elements.galleryProgressTitle.textContent = loading
          ? `正在加载下一批素材...`
          : `流式浏览中 (向下滚动自动载入)`;
      }
    }
  }

  async function loadAssetsPage(reset = false) {
    if (!hasSnapshotSelection()) return;

    if (reset) {
      state.requestToken++;
      state.offset = 0;
      state.hasMore = true;
      state.loadingPage = false;
      state.loadedAssets.clear();
      state.cardElements.clear();
      elements.assetWaterfall.innerHTML = "";
      if (elements.endOfResults) elements.endOfResults.classList.add("hidden");
      if (elements.importProgressWrap) elements.importProgressWrap.classList.add("hidden");
      updateGalleryProgress(true);
    }

    if (state.loadingPage || !state.hasMore) {
      return;
    }

    state.loadingPage = true;
    const currentToken = state.requestToken;
    if (elements.loadingSpinner) elements.loadingSpinner.classList.remove("hidden");
    updateGalleryProgress(true);

    try {
      const params = new URLSearchParams();
      params.set("offset", String(state.offset));
      params.set("limit", String(state.limit));

      const selectedIds = state.filters.import_ids || [];
      if (selectedIds.length > 0) {
        if (!selectedIds.includes("__all__")) {
          params.set("import_ids", JSON.stringify(selectedIds));
        }
      } else if (state.filters.import_id && state.filters.import_id !== "__all__") {
        params.set("import_id", state.filters.import_id);
      }

      if (state.filters.text) params.set("text", state.filters.text);
      if (state.filters.artist) params.set("artist", state.filters.artist);
      if (state.filters.character) params.set("character", state.filters.character);
      if (state.filters.action_group) params.set("action_group", state.filters.action_group);
      if (state.filters.action) params.set("action", state.filters.action);
      if (Object.keys(state.filters.facets).length > 0) {
        params.set("facets", JSON.stringify(state.filters.facets));
      }
      if (state.filters.tags && state.filters.tags.size > 0) {
        params.set("tags", JSON.stringify([...state.filters.tags]));
      }
      if (state.filters.posted_mode === "posted") {
        params.set("posted", "true");
      } else if (state.filters.posted_mode === "unposted") {
        params.set("posted", "false");
      }
      if (state.filters.favorite_mode !== "all") {
        params.set("favorite_mode", state.filters.favorite_mode);
        const favSet = getFavoritesSet();
        params.set("favorite_ids", JSON.stringify([...favSet]));
      }
      const sortBy = (state.filters && state.filters.sort_by) || "order_asc";
      params.set("sort_by", sortBy);

      const res = await fetch(`/api/library/assets?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`加载素材失败 (${res.status})`);
      }

      if (currentToken !== state.requestToken) {
        return;
      }

      const page = await res.json();
      state.total = page.total || 0;
      state.hasMore = page.has_more;
      state.offset = page.next_offset !== null && page.next_offset !== undefined
        ? page.next_offset
        : (state.offset + page.items.length);

      if (page.items.length === 0 && state.loadedAssets.size === 0) {
        elements.assetWaterfall.innerHTML = `
          <div class="empty-snapshot-guide">
            <div class="empty-guide-icon">🔍</div>
            <h3>未找到匹配的素材</h3>
            <p>请尝试调整搜索关键词、清除节点或分类属性筛选条件</p>
          </div>
        `;
      } else {
        for (const item of page.items) {
          if (!state.loadedAssets.has(item.asset_id)) {
            state.loadedAssets.set(item.asset_id, item);
            const card = renderAssetCard(item);
            state.cardElements.set(item.asset_id, card);
            elements.assetWaterfall.appendChild(card);
          }
        }
      }

      // 更新角标状态
      if (elements.assetCountBadge) {
        elements.assetCountBadge.textContent = `共 ${state.total.toLocaleString()} 张 (已载入 ${state.loadedAssets.size.toLocaleString()} 张)`;
      }

      updateGalleryProgress(false);

      if (!state.hasMore && state.loadedAssets.size > 0) {
        if (elements.endOfResults) elements.endOfResults.classList.remove("hidden");
      }
    } catch (err) {
      console.error("加载素材分页异常:", err);
      if (currentToken === state.requestToken) {
        showNotice(`加载素材异常：${err.message}`, "error");
      }
    } finally {
      if (currentToken === state.requestToken) {
        state.loadingPage = false;
        if (elements.loadingSpinner) elements.loadingSpinner.classList.add("hidden");
        updateGalleryProgress(false);
      }
    }
  }

  async function switchSnapshot(target) {
    let newImportIds = [];
    if (Array.isArray(target)) {
      newImportIds = target.filter(Boolean);
    } else if (typeof target === "string" && target.trim()) {
      newImportIds = target.includes(",")
        ? target.split(",").map((x) => x.trim()).filter(Boolean)
        : [target.trim()];
    }

    const oldKey = getSelectedImportKey();
    const newKey = newImportIds.includes("__all__") ? "__all__" : [...newImportIds].sort().join(",");

    // 1. 如果之前有选中的快照组合，保存旧快照的当前独立筛选
    if (oldKey && oldKey !== newKey) {
      saveSnapshotFilters(oldKey, state.filters);
    }

    // 2. 记忆当前最后选中的快照组合
    if (newKey) {
      localStorage.setItem(LAST_SELECTED_IMPORTS_KEY, JSON.stringify(newImportIds));
      localStorage.setItem(LAST_SELECTED_IMPORT_KEY, newImportIds[0] || "");
    } else {
      localStorage.removeItem(LAST_SELECTED_IMPORTS_KEY);
      localStorage.removeItem(LAST_SELECTED_IMPORT_KEY);
    }

    // 3. 并行从服务端同步已持久化的收藏标记
    syncFavoritesFromServer(newKey).then(() => {
      if (state.filters.favorite_mode !== "all") {
        applyClientFilter();
      }
    });

    // 4. 加载目标快照独立的专属筛选配置
    state.filters = getSnapshotFilters(newKey);
    state.filters.import_ids = newImportIds;
    state.filters.import_id = newImportIds.includes("__all__") ? "__all__" : (newImportIds[0] || "");
    state.selectedAssetIds.clear();
    updateSelectionBadges();

    // 5. 同步更新所有 UI 筛选控件与快照选择器展示
    syncFilterInputsFromState();
    updateSnapshotTriggerDisplay();
    renderSnapshotList();

    if (elements.importSelect) {
      elements.importSelect.value = newImportIds.length === 1 ? newImportIds[0] : (newImportIds.includes("__all__") ? "__all__" : "");
    }

    if (!newImportIds.length) {
      if (elements.importProgressWrap) elements.importProgressWrap.classList.add("hidden");
      if (elements.galleryProgressBanner) elements.galleryProgressBanner.classList.add("hidden");
      if (elements.assetCountBadge) elements.assetCountBadge.textContent = "";
      elements.assetWaterfall.innerHTML = `
        <div id="empty-snapshot-guide" class="empty-snapshot-guide">
          <div class="empty-guide-icon">📂</div>
          <h3>请选择导入快照</h3>
          <p>在左侧选择数据源快照即可开始流式加载并浏览、筛选素材</p>
        </div>
      `;
      state.loadedAssets.clear();
      state.cardElements.clear();
      renderActiveChips();
      return;
    }

    loadFacets();
    loadAssetsPage(true);
  }

  async function jumpToSnapshotAndLocate(importId, assetId, snapName, targetOrder) {
    if (!importId || !assetId) return;

    // 1. 关闭 Lightbox 弹窗
    if (elements.previewDialog && elements.previewDialog.open) {
      elements.previewDialog.close();
    }

    const currentIds = Array.isArray(state.filters.import_ids) ? state.filters.import_ids : [];
    const isAlreadySelected = currentIds.length === 1 && currentIds[0] === importId;

    if (!isAlreadySelected) {
      // 切换至目标快照
      await switchSnapshot([importId]);
    }

    // 确保排序按原始快照正序 order_asc，重置文本与状态过滤，确保图片必然存在于当前视图中
    let filterChanged = false;
    if (state.filters.text) {
      state.filters.text = "";
      if (elements.textFilter) elements.textFilter.value = "";
      filterChanged = true;
    }
    if (state.filters.sort_by !== "order_asc") {
      state.filters.sort_by = "order_asc";
      if (elements.sortSelect) elements.sortSelect.value = "order_asc";
      filterChanged = true;
    }
    if (state.filters.posted_mode !== "all") {
      state.filters.posted_mode = "all";
      const postedRow = document.querySelector('.quick-filter-row[data-filter-type="posted"]');
      if (postedRow) {
        postedRow.querySelectorAll(".segment-btn").forEach((b) => b.classList.toggle("active", b.dataset.val === "all"));
      }
      filterChanged = true;
    }
    if (state.filters.favorite_mode !== "all") {
      state.filters.favorite_mode = "all";
      const favRow = document.querySelector('.quick-filter-row[data-filter-type="favorite"]');
      if (favRow) {
        favRow.querySelectorAll(".segment-btn").forEach((b) => b.classList.toggle("active", b.dataset.val === "all"));
      }
      filterChanged = true;
    }

    if (filterChanged) {
      saveSnapshotFilters(importId, state.filters);
      renderActiveChips();
      await loadAssetsPage(true);
    }

    // 2. 检查瀑布流中是否已有卡片，若在更深页数则按需持续加载直到目标卡片渲染
    let card = state.cardElements.get(assetId);
    let maxTries = 25; // 最多自动预载 25 页 (1500张)，防止无限循环
    while (!card && state.hasMore && maxTries > 0) {
      maxTries--;
      await loadAssetsPage(false);
      card = state.cardElements.get(assetId);
    }

    // 3. 平滑滚动并持久高亮目标卡片（持久聚焦边框 + 1.2s 聚光灯聚焦）
    if (card) {
      setFocusedCard(assetId, true, true);
      showNotice(`✨ 已定位至快照【${snapName || importId}】第 ${(targetOrder ?? 0) + 1} 张图片`, "success");
    } else {
      showNotice(`已切换至快照【${snapName || importId}】`, "info");
    }
  }

  function applyInstantFilters() {
    const importKey = getSelectedImportKey();
    if (importKey) {
      saveSnapshotFilters(importKey, state.filters);
    }
    renderActiveChips();
    if (hasSnapshotSelection()) {
      loadAssetsPage(true);
    }
  }

  function renderActiveChips() {
    if (!elements.activeChipsList) return;
    elements.activeChipsList.innerHTML = "";
    const activeItems = [];

    if (state.filters.text) {
      activeItems.push({
        type: "text",
        label: "关键词",
        value: state.filters.text,
        clear: () => {
          state.filters.text = "";
          elements.textFilter.value = "";
          applyInstantFilters();
        },
      });
    }

    for (const role of ["artist", "character", "action_group", "action"]) {
      if (state.filters[role]) {
        const inputEl = {
          artist: elements.artistFilter,
          character: elements.characterFilter,
          action_group: elements.groupFilter,
          action: elements.actionFilter,
        }[role];
        activeItems.push({
          type: "node",
          role: role,
          label: ROLE_LABELS[role] || role,
          value: state.filters[role],
          clear: () => {
            state.filters[role] = "";
            if (inputEl) {
              inputEl.value = "";
              const clearBtn = inputEl.closest(".node-picker")?.querySelector(".node-clear");
              if (clearBtn) clearBtn.hidden = true;
            }
            applyInstantFilters();
          },
        });
      }
    }

    for (const [field, values] of Object.entries(state.filters.facets)) {
      for (const val of values) {
        activeItems.push({
          type: "facet",
          field: field,
          label: FACET_LABELS[field] || field,
          value: val,
          clear: () => {
            state.filters.facets[field] = state.filters.facets[field].filter((x) => x !== val);
            if (!state.filters.facets[field].length) {
              delete state.filters.facets[field];
            }
            renderFacetAccordion();
            applyInstantFilters();
          },
        });
      }
    }

    if (state.filters.tags && state.filters.tags.size > 0) {
      for (const tag of state.filters.tags) {
        activeItems.push({
          type: "tag",
          label: "标签",
          value: `🏷️ ${tag}`,
          clear: () => {
            state.filters.tags.delete(tag);
            renderTagChips();
            applyInstantFilters();
          },
        });
      }
    }

    if (state.filters.favorite_mode !== "all") {
      activeItems.push({
        type: "quick",
        label: "收藏状态",
        value: state.filters.favorite_mode === "favorited" ? "⭐ 仅看已收藏" : "☆ 仅看未收藏",
        clear: () => {
          state.filters.favorite_mode = "all";
          syncQuickFilterButtons();
          applyInstantFilters();
        },
      });
    }

    if (state.filters.posted_mode !== "all") {
      activeItems.push({
        type: "quick",
        label: "投稿状态",
        value: state.filters.posted_mode === "posted" ? "📮 仅看已投稿" : "📥 仅看未投稿",
        clear: () => {
          state.filters.posted_mode = "all";
          syncQuickFilterButtons();
          applyInstantFilters();
        },
      });
    }

    if (!activeItems.length) {
      if (elements.activeFilterChips) elements.activeFilterChips.hidden = true;
      return;
    }

    if (elements.activeFilterChips) elements.activeFilterChips.hidden = false;
    for (const item of activeItems) {
      const chip = document.createElement("span");
      chip.className = "active-chip";
      chip.innerHTML = `<span class="active-chip-role">${escapeHtml(item.label)}:</span> <strong>${escapeHtml(item.value)}</strong>`;
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "active-chip-remove";
      removeBtn.textContent = "✕";
      removeBtn.title = "移除该筛选";
      removeBtn.addEventListener("click", item.clear);
      chip.appendChild(removeBtn);
      elements.activeChipsList.appendChild(chip);
    }
  }

  async function loadFacets() {
    try {
      let url = "/api/library/facets";
      const selectedIds = state.filters.import_ids || [];
      if (selectedIds.length > 0) {
        if (!selectedIds.includes("__all__")) {
          url = `/api/library/facets?import_ids=${encodeURIComponent(selectedIds.join(","))}`;
        }
      } else if (state.filters.import_id && state.filters.import_id !== "__all__") {
        url = `/api/library/facets?import_id=${encodeURIComponent(state.filters.import_id)}`;
      }
      const res = await fetch(url);
      if (res.ok) {
        state.availableFacets = await res.json();
        renderFacetAccordion();
      }
    } catch (err) {
      console.warn("加载 Facet 选项失败", err);
    }
  }

  function renderFacetAccordion() {
    if (!elements.facetAccordion) return;
    elements.facetAccordion.innerHTML = "";

    const availableCategories = Object.keys(state.availableFacets);
    if (!availableCategories.length) {
      elements.facetAccordion.innerHTML = '<div class="facet-empty-hint">当前快照无可用的 classify 属性标签</div>';
      if (elements.clearFacetsBtn) elements.clearFacetsBtn.hidden = true;
      return;
    }

    let hasAnySelected = false;
    for (const conf of FACET_CONFIG) {
      const cat = conf.key;
      const tags = state.availableFacets[cat] || [];
      if (!tags.length) continue;

      const selectedTags = state.filters.facets[cat] || [];
      const selectedCount = selectedTags.length;
      if (selectedCount > 0) hasAnySelected = true;

      const isOpen = state.expandedFacetCategories.has(cat);

      const itemEl = document.createElement("div");
      itemEl.className = `facet-accordion-item ${isOpen ? "open" : ""} ${selectedCount > 0 ? "has-selected" : ""}`;
      itemEl.dataset.category = cat;

      const headerBtn = document.createElement("button");
      headerBtn.type = "button";
      headerBtn.className = "facet-accordion-header";
      headerBtn.innerHTML = `
        <span class="facet-accordion-title">
          <span>${conf.icon}</span>
          <span>${conf.label} (${cat})</span>
        </span>
        <span class="facet-accordion-meta">
          ${selectedCount > 0 ? `<span class="facet-accordion-badge">${selectedCount}</span>` : ""}
          <span class="facet-accordion-arrow">▶</span>
        </span>
      `;

      headerBtn.addEventListener("click", () => {
        if (state.expandedFacetCategories.has(cat)) {
          state.expandedFacetCategories.delete(cat);
        } else {
          state.expandedFacetCategories.add(cat);
        }
        renderFacetAccordion();
      });

      const bodyEl = document.createElement("div");
      bodyEl.className = "facet-accordion-body";

      const chipsContainer = document.createElement("div");
      chipsContainer.className = "facet-chips-container";

      for (const tag of tags) {
        const isSelected = selectedTags.includes(tag);
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = `facet-tag-chip ${isSelected ? "active" : ""}`;
        chip.innerHTML = `${isSelected ? "✓ " : ""}${escapeHtml(tag)}`;
        chip.addEventListener("click", (e) => {
          e.stopPropagation();
          if (isSelected) {
            state.filters.facets[cat] = state.filters.facets[cat].filter((x) => x !== tag);
            if (!state.filters.facets[cat].length) {
              delete state.filters.facets[cat];
            }
          } else {
            if (!state.filters.facets[cat]) state.filters.facets[cat] = [];
            state.filters.facets[cat].push(tag);
          }
          renderFacetAccordion();
          applyInstantFilters();
        });
        chipsContainer.appendChild(chip);
      }

      bodyEl.appendChild(chipsContainer);
      itemEl.appendChild(headerBtn);
      itemEl.appendChild(bodyEl);
      elements.facetAccordion.appendChild(itemEl);
    }

    if (elements.clearFacetsBtn) {
      elements.clearFacetsBtn.hidden = !hasAnySelected;
    }
  }

  // ================= 导入与筛选标签面板 =================

  async function loadTagsList() {
    try {
      const res = await fetch("/api/library/tags");
      if (res.ok) {
        state.availableTags = await res.json();
        renderTagChips();
      }
    } catch (err) {
      console.warn("加载标签列表失败", err);
    }
  }

  function renderTagChips() {
    if (!elements.tagFilterSection || !elements.tagChipsContainer) return;
    const tags = state.availableTags || [];
    if (!tags.length) {
      elements.tagFilterSection.hidden = true;
      return;
    }
    elements.tagFilterSection.hidden = false;
    elements.tagChipsContainer.innerHTML = "";

    for (const t of tags) {
      const chip = document.createElement("button");
      chip.type = "button";
      const isActive = Boolean(state.filters.tags && state.filters.tags.has(t.name));
      chip.className = `tag-chip ${isActive ? "active" : ""}`;
      chip.dataset.tag = t.name;
      chip.innerHTML = `<span>🏷️ ${escapeHtml(t.name)}</span><span class="tag-chip-count">${t.count}</span>`;
      chip.addEventListener("click", () => {
        if (state.filters.tags.has(t.name)) {
          state.filters.tags.delete(t.name);
        } else {
          state.filters.tags.add(t.name);
        }
        renderTagChips();
        applyInstantFilters();
      });
      elements.tagChipsContainer.appendChild(chip);
    }

    if (elements.clearTagFiltersBtn) {
      elements.clearTagFiltersBtn.hidden = !(state.filters.tags && state.filters.tags.size > 0);
    }
  }

  function renderAssetCard(item) {
    const card = document.createElement("div");
    card.className = "asset-card";
    card.dataset.assetId = item.asset_id;
    if (state.selectedAssetIds.has(item.asset_id)) {
      card.classList.add("selected");
    }

    const ratio = item.width && item.height ? `${item.width} / ${item.height}` : "1 / 1";
    const previewUrl = `/api/assets/${encodeURIComponent(item.asset_id)}/preview`;

    const realUsage = (item.usage || []).filter(u => u !== "favorite");
    const hasUsage = realUsage.length > 0;
    const usageBadgeHtml = hasUsage
      ? `<span class="asset-usage-badge" title="已投稿/使用: ${escapeHtml(realUsage.join(", "))}">已投稿</span>`
      : "";

    const isFav = isAssetFavorited(item.asset_id);
    const selectedArr = Array.from(state.selectedAssetIds);
    const orderIdx = selectedArr.indexOf(item.asset_id);
    const isSelected = orderIdx !== -1;
    const orderBadgeHtml = isSelected
      ? `<span class="asset-order-badge" title="点击取消选中"><span class="badge-num">${orderIdx + 1}</span></span>`
      : "";

    const isFocused = state.focusedAssetId === item.asset_id;
    if (isFocused) card.classList.add("is-focused-card");
    if (isSelected) {
      card.classList.add("selected");
      card.classList.add("is-batch-selected");
    }

    const tagsHtml = (item.tags && item.tags.length > 0)
      ? `<div class="asset-tags-row" style="margin-top: 3px; display: flex; flex-wrap: wrap; gap: 3px;">${item.tags.map(t => `<span class="asset-tag-badge">🏷️ ${escapeHtml(t)}</span>`).join("")}</div>`
      : "";

    card.innerHTML = `
      <div class="asset-thumb-wrap" style="aspect-ratio: ${ratio};">
        <div class="card-batch-checkbox ${isSelected ? "checked" : ""}" data-action="toggle-batch-select" title="勾选多选 (按住 Ctrl / Shift 可快速多选)">✓</div>
        <input type="checkbox" class="asset-checkbox" ${isSelected ? "checked" : ""} style="display:none;">
        ${orderBadgeHtml}
        ${usageBadgeHtml}
        <button class="asset-star-btn ${isFav ? "starred" : ""}" type="button" title="收藏">★</button>
        <img class="asset-thumb" loading="lazy" src="${previewUrl}" alt="${escapeHtml(item.display_name)}">
      </div>
      <div class="asset-info">
        <div class="asset-name" title="${escapeHtml(item.display_name)}">${escapeHtml(item.display_name)}</div>
        ${tagsHtml}
      </div>
    `;

    const starBtn = card.querySelector(".asset-star-btn");
    const orderBadge = card.querySelector(".asset-order-badge");

    if (orderBadge) {
      orderBadge.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        toggleAssetSelection(item.asset_id, false);
      });
    }

    // 收藏按钮点击
    starBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const nowFav = toggleFavorite(item.asset_id);
      starBtn.classList.toggle("starred", nowFav);
      starBtn.classList.remove("star-pop");
      void starBtn.offsetWidth; // 强制 reflow 以重触发动画
      starBtn.classList.add("star-pop");
      if (state.filters.favorite_mode !== "all") {
        applyClientFilter();
      }
    });

    // 单击卡片或各部件交互
    card.addEventListener("click", (e) => {
      if (e.target.closest(".asset-star-btn") || e.target.closest(".asset-order-badge")) {
        return;
      }

      // 1. 点击批量勾选圆标 -> 触发多选
      if (e.target.closest(".card-batch-checkbox") || e.target.dataset.action === "toggle-batch-select") {
        e.stopPropagation();
        const nextState = !state.selectedAssetIds.has(item.asset_id);
        toggleAssetSelection(item.asset_id, nextState);
        return;
      }

      // 2. Ctrl / Cmd 点选 -> 切换加入多选集合
      if (e.ctrlKey || e.metaKey) {
        e.stopPropagation();
        const nextState = !state.selectedAssetIds.has(item.asset_id);
        toggleAssetSelection(item.asset_id, nextState);
        setFocusedCard(item.asset_id, false, false);
        return;
      }

      // 3. Shift 连选 -> 区间多选
      if (e.shiftKey) {
        e.stopPropagation();
        selectRangeTo(item.asset_id);
        setFocusedCard(item.asset_id, false, false);
        return;
      }

      // 4. 处于批量管理模式下，单击卡片即切换多选
      if (state.isBatchMode) {
        e.stopPropagation();
        const nextState = !state.selectedAssetIds.has(item.asset_id);
        toggleAssetSelection(item.asset_id, nextState);
        setFocusedCard(item.asset_id, false, false);
        return;
      }

      // 5. 普通单击：设置当前聚焦卡片，并打开大图详情
      setFocusedCard(item.asset_id, false, false);
      if (e.target.closest(".asset-thumb")) {
        openLightbox(item.asset_id);
      }
    });

    card.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      openLightbox(item.asset_id);
    });

    return card;
  }

  // ================= 瀑布流持久聚焦与聚光灯聚焦 =================

  function setFocusedCard(assetId, smoothScroll = false, withSpotlight = false) {
    if (!assetId) return;

    if (state.focusedAssetId && state.focusedAssetId !== assetId) {
      const oldCard = state.cardElements.get(state.focusedAssetId) || elements.assetWaterfall?.querySelector(`.asset-card[data-asset-id="${state.focusedAssetId}"]`);
      if (oldCard) oldCard.classList.remove("is-focused-card");
    }

    state.focusedAssetId = assetId;
    const card = state.cardElements.get(assetId) || elements.assetWaterfall?.querySelector(`.asset-card[data-asset-id="${assetId}"]`);
    if (card) {
      card.classList.add("is-focused-card");
      if (smoothScroll) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      if (withSpotlight && elements.assetWaterfall) {
        elements.assetWaterfall.classList.add("waterfall-spotlight-active");
        setTimeout(() => {
          if (elements.assetWaterfall) {
            elements.assetWaterfall.classList.remove("waterfall-spotlight-active");
          }
        }, 1200);
      }
    }
  }

  function clearCardFocus() {
    if (state.focusedAssetId) {
      const oldCard = state.cardElements.get(state.focusedAssetId) || elements.assetWaterfall?.querySelector(`.asset-card[data-asset-id="${state.focusedAssetId}"]`);
      if (oldCard) oldCard.classList.remove("is-focused-card");
      state.focusedAssetId = null;
    }
  }

  // ================= 批量多选管理模式与多选操作 =================

  function toggleBatchMode(forceState = null) {
    state.isBatchMode = forceState !== null ? Boolean(forceState) : !state.isBatchMode;
    document.body.classList.toggle("body-batch-mode-active", state.isBatchMode);
    if (elements.btnBatchToggle) {
      elements.btnBatchToggle.classList.toggle("active", state.isBatchMode);
      elements.btnBatchToggle.textContent = state.isBatchMode ? "✓ 退出批量" : "☑ 批量管理";
    }
    if (!state.isBatchMode && state.selectedAssetIds.size === 0) {
      if (elements.galleryBatchBar) elements.galleryBatchBar.classList.add("hidden");
    }
  }

  function toggleAssetSelection(assetId, isSelected) {
    if (isSelected) {
      state.selectedAssetIds.add(assetId);
      state.lastSelectedAssetId = assetId;
    } else {
      state.selectedAssetIds.delete(assetId);
    }
    updateSelectionBadges();
  }

  function selectRangeTo(targetAssetId) {
    if (!targetAssetId) return;
    const cards = Array.from(elements.assetWaterfall.querySelectorAll(".asset-card:not(.filtered-out)"));
    if (!state.lastSelectedAssetId) {
      toggleAssetSelection(targetAssetId, true);
      return;
    }
    const idx1 = cards.findIndex(c => c.dataset.assetId === state.lastSelectedAssetId);
    const idx2 = cards.findIndex(c => c.dataset.assetId === targetAssetId);
    if (idx1 === -1 || idx2 === -1) {
      toggleAssetSelection(targetAssetId, true);
      return;
    }
    const start = Math.min(idx1, idx2);
    const end = Math.max(idx1, idx2);
    for (let i = start; i <= end; i++) {
      const aid = cards[i].dataset.assetId;
      if (aid) state.selectedAssetIds.add(aid);
    }
    state.lastSelectedAssetId = targetAssetId;
    updateSelectionBadges();
  }

  function updateSelectionBadges() {
    const selectedArr = Array.from(state.selectedAssetIds);
    const count = selectedArr.length;

    if (elements.selectedCountBadge) {
      elements.selectedCountBadge.textContent = `已选 ${count} 项`;
    }
    if (elements.batchSelectedCount) {
      elements.batchSelectedCount.textContent = `已选中 ${count} 张图片`;
    }

    // 控制底部悬浮操作栏显示与隐藏
    if (elements.galleryBatchBar) {
      if (count > 0) {
        elements.galleryBatchBar.classList.remove("hidden");
      } else {
        elements.galleryBatchBar.classList.add("hidden");
      }
    }

    // 遍历瀑布流中已渲染的卡片，同步其选中态和次序徽章与勾选圆标
    elements.assetWaterfall.querySelectorAll(".asset-card").forEach((card) => {
      const aid = card.dataset.assetId;
      const idx = selectedArr.indexOf(aid);
      const isSel = idx !== -1;

      card.classList.toggle("selected", isSel);
      card.classList.toggle("is-batch-selected", isSel);

      const cb = card.querySelector(".card-batch-checkbox");
      if (cb) {
        cb.classList.toggle("checked", isSel);
      }

      let orderBadge = card.querySelector(".asset-order-badge");
      if (isSel) {
        const orderNum = idx + 1;
        if (!orderBadge) {
          orderBadge = document.createElement("span");
          orderBadge.className = "asset-order-badge";
          orderBadge.title = "点击取消选中";
          orderBadge.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
            toggleAssetSelection(aid, false);
          });
          const wrap = card.querySelector(".asset-thumb-wrap");
          if (wrap) wrap.appendChild(orderBadge);
        }
        orderBadge.innerHTML = `<span class="badge-num">${orderNum}</span>`;
      } else {
        if (orderBadge) orderBadge.remove();
      }
    });
  }

  function clearAllAssetSelection() {
    state.selectedAssetIds.clear();
    state.lastSelectedAssetId = null;
    updateSelectionBadges();
  }

  function selectAllVisible() {
    state.loadedAssets.forEach((item, id) => {
      state.selectedAssetIds.add(id);
    });
    updateSelectionBadges();
  }

  // ================= 批量操作 API 处理器 =================

  async function handleBatchAction(action, extraPayload = {}) {
    const assetIds = Array.from(state.selectedAssetIds);
    if (!assetIds.length) {
      showNotice("请先选择图片", "info");
      return;
    }

    try {
      const res = await fetch("/api/library/batch-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset_ids: assetIds,
          action,
          ...extraPayload,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showNotice(data.detail || "批量操作失败", "error");
        return;
      }

      if (action === "favorite") {
        assetIds.forEach((aid) => {
          state.favorites.add(aid);
          const card = state.cardElements.get(aid);
          if (card) {
            const btn = card.querySelector(".asset-star-btn");
            if (btn) btn.classList.add("starred");
          }
        });
        showNotice(`⭐ 已批量收藏 ${assetIds.length} 张图片`, "success");
      } else if (action === "unfavorite") {
        assetIds.forEach((aid) => {
          state.favorites.delete(aid);
          const card = state.cardElements.get(aid);
          if (card) {
            const btn = card.querySelector(".asset-star-btn");
            if (btn) btn.classList.remove("starred");
          }
        });
        showNotice(`☆ 已批量取消收藏 ${assetIds.length} 张图片`, "info");
      } else if (action === "mark_posted") {
        assetIds.forEach((aid) => {
          const card = state.cardElements.get(aid);
          if (card) {
            let badge = card.querySelector(".asset-usage-badge");
            if (!badge) {
              badge = document.createElement("span");
              badge.className = "asset-usage-badge";
              badge.textContent = "已投稿";
              const wrap = card.querySelector(".asset-thumb-wrap");
              if (wrap) wrap.appendChild(badge);
            }
          }
        });
        showNotice(`📮 已将 ${assetIds.length} 张图片标记为已投稿`, "success");
      } else if (action === "unmark_posted") {
        assetIds.forEach((aid) => {
          const card = state.cardElements.get(aid);
          if (card) {
            const badge = card.querySelector(".asset-usage-badge");
            if (badge) badge.remove();
          }
        });
        showNotice(`📥 已将 ${assetIds.length} 张图片取消已投稿标记`, "info");
      } else if (action === "add_tags") {
        showNotice(`🏷️ 已成功为 ${assetIds.length} 张图片追加标签`, "success");
        loadFacets();
      }
    } catch (err) {
      console.error("[BatchAction] 批量操作异常:", err);
      showNotice("批量操作网络异常", "error");
    }
  }

  function handleBatchTagging() {
    const assetIds = Array.from(state.selectedAssetIds);
    if (!assetIds.length) {
      showNotice("请先选择图片", "info");
      return;
    }
    const input = prompt(`为选中的 ${assetIds.length} 张图片批量追加标签（多个标签用英文逗号或空格隔开）：`);
    if (!input || !input.trim()) return;
    const tags = input
      .split(/[,，\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.length === 0) return;
    handleBatchAction("add_tags", { tags });
  }

  function batchCopySelectedPaths() {
    const assetIds = Array.from(state.selectedAssetIds);
    if (!assetIds.length) {
      showNotice("请先选择图片", "info");
      return;
    }
    const paths = [];
    assetIds.forEach((aid) => {
      const item = state.loadedAssets.get(aid);
      if (item && item.path) {
        paths.push(item.path);
      }
    });
    if (paths.length === 0) {
      showNotice("未获取到选中图片的物理路径", "warning");
      return;
    }
    navigator.clipboard.writeText(paths.join("\n")).then(() => {
      showNotice(`📋 已成功复制 ${paths.length} 个文件路径到剪贴板`, "success");
    }).catch(() => {
      showNotice("复制到剪贴板失败，请手动复制", "error");
    });
  }

  function navigateWaterfallFocus(direction) {
    const cards = Array.from(elements.assetWaterfall.querySelectorAll(".asset-card:not(.filtered-out)"));
    if (!cards.length) return;
    if (!state.focusedAssetId) {
      setFocusedCard(cards[0].dataset.assetId, true, false);
      return;
    }
    const curIdx = cards.findIndex((c) => c.dataset.assetId === state.focusedAssetId);
    if (curIdx === -1) {
      setFocusedCard(cards[0].dataset.assetId, true, false);
      return;
    }

    let targetIdx = curIdx;
    if (direction === "ArrowLeft") {
      targetIdx = Math.max(0, curIdx - 1);
    } else if (direction === "ArrowRight") {
      targetIdx = Math.min(cards.length - 1, curIdx + 1);
    } else if (direction === "ArrowUp" || direction === "ArrowDown") {
      const curCard = cards[curIdx];
      const curRect = curCard.getBoundingClientRect();
      const curCenterX = curRect.left + curRect.width / 2;

      let candidate = null;
      let minDistance = Infinity;

      for (let i = 0; i < cards.length; i++) {
        if (i === curIdx) continue;
        const r = cards[i].getBoundingClientRect();
        const isUp = direction === "ArrowUp" && r.bottom < curRect.top + 10;
        const isDown = direction === "ArrowDown" && r.top > curRect.bottom - 10;
        if (isUp || isDown) {
          const centerX = r.left + r.width / 2;
          const centerY = r.top + r.height / 2;
          const dist = Math.hypot(centerX - curCenterX, (centerY - (curRect.top + curRect.height / 2)) * 0.5);
          if (dist < minDistance) {
            minDistance = dist;
            candidate = i;
          }
        }
      }
      if (candidate !== null) {
        targetIdx = candidate;
      }
    }

    if (targetIdx !== curIdx && cards[targetIdx]) {
      setFocusedCard(cards[targetIdx].dataset.assetId, true, false);
    }
  }

  // ================= Pro Lightbox 大图与图片详情控制器 =================

  state.lightbox = {
    activeAssetId: null,
    assetList: [],
    currentIndex: -1,
    history: [],
    relatedViewMode: localStorage.getItem("pw_related_view_mode") || "grid",
  };

  function getVisibleAssetIds() {
    const list = [];
    state.loadedAssets.forEach((item, assetId) => {
      list.push(assetId);
    });
    return list;
  }

  function updateLightboxBackButton() {
    if (!elements.lightboxBackBtn) return;
    const historyLen = state.lightbox.history ? state.lightbox.history.length : 0;
    if (historyLen > 0) {
      const lastItem = state.lightbox.history[historyLen - 1];
      elements.lightboxBackBtn.classList.remove("hidden");
      if (elements.lightboxBackLabel) {
        const rawName = lastItem.displayName || "原图";
        const shortName = rawName.length > 18 ? rawName.slice(0, 16) + "..." : rawName;
        elements.lightboxBackLabel.textContent = `返回: ${shortName}`;
      }
      elements.lightboxBackBtn.title = `返回上一张: ${lastItem.displayName || ''} (Alt+← / Backspace)`;
    } else {
      elements.lightboxBackBtn.classList.add("hidden");
    }
  }

  function popLightboxHistory() {
    if (!state.lightbox.history || state.lightbox.history.length === 0) return;
    const prev = state.lightbox.history.pop();
    if (!prev) return;
    state.lightbox.assetList = prev.assetList && prev.assetList.length > 0 ? prev.assetList : getVisibleAssetIds();
    state.lightbox.currentIndex = prev.currentIndex >= 0 ? prev.currentIndex : state.lightbox.assetList.indexOf(prev.assetId);
    state.lightbox.activeAssetId = prev.assetId;
    updateLightboxBackButton();
    renderLightboxCurrent();
  }

  async function openLightbox(assetId, customAssetList = null, options = {}) {
    const pushHistory = options.pushHistory === true;
    if (pushHistory && state.lightbox.activeAssetId && state.lightbox.activeAssetId !== assetId) {
      const currentItem = state.loadedAssets.get(state.lightbox.activeAssetId);
      if (!state.lightbox.history) state.lightbox.history = [];
      state.lightbox.history.push({
        assetId: state.lightbox.activeAssetId,
        assetList: [...state.lightbox.assetList],
        currentIndex: state.lightbox.currentIndex,
        displayName: currentItem?.display_name || state.lightbox.activeAssetId,
      });
    } else if (!pushHistory && (!elements.previewDialog || !elements.previewDialog.open)) {
      state.lightbox.history = [];
    }

    if (Array.isArray(customAssetList) && customAssetList.length > 0) {
      state.lightbox.assetList = [...customAssetList];
    } else if (!pushHistory || !state.lightbox.assetList.length) {
      state.lightbox.assetList = getVisibleAssetIds();
    }
    state.lightbox.currentIndex = state.lightbox.assetList.indexOf(assetId);
    if (state.lightbox.currentIndex === -1 && state.lightbox.assetList.length > 0) {
      state.lightbox.currentIndex = 0;
      assetId = state.lightbox.assetList[0];
    }
    state.lightbox.activeAssetId = assetId;

    if (!elements.previewDialog.open) {
      elements.previewDialog.showModal();
    }

    updateLightboxBackButton();
    await renderLightboxCurrent();
  }

  function navigateLightbox(step) {
    if (!state.lightbox.assetList.length) return;
    const total = state.lightbox.assetList.length;
    let nextIdx = state.lightbox.currentIndex + step;
    if (nextIdx < 0) nextIdx = total - 1;
    if (nextIdx >= total) nextIdx = 0;
    state.lightbox.currentIndex = nextIdx;
    state.lightbox.activeAssetId = state.lightbox.assetList[nextIdx];
    renderLightboxCurrent();
  }

  async function renderLightboxCurrent() {
    const assetId = state.lightbox.activeAssetId;
    if (!assetId) return;

    const item = state.loadedAssets.get(assetId);
    const total = state.lightbox.assetList.length;
    const currentNum = state.lightbox.currentIndex + 1;

    state.lightbox.isExported = false;
    state.lightbox.exportItem = null;
    if (elements.lightboxModeTabs) {
      elements.lightboxModeTabs.classList.remove("hidden");
      const tabView = elements.lightboxModeTabs.querySelector('[data-lb-tab="view"]');
      const tabInpaint = elements.lightboxModeTabs.querySelector('[data-lb-tab="inpaint"]');
      const tabEdit = elements.lightboxModeTabs.querySelector('[data-lb-tab="edit"]');
      if (tabView) tabView.classList.remove("hidden");
      if (tabInpaint) tabInpaint.classList.remove("hidden");
      if (tabEdit) tabEdit.classList.add("hidden");
    }
    switchLightboxMode("view");

    // 1. 顶部 Header 状态
    elements.lightboxCounter.textContent = `${currentNum} / ${total}`;
    elements.lightboxFilename.textContent = item?.display_name || assetId;
    elements.lightboxFilepath.textContent = item?.path || "";

    // 2. 左侧大图 (带时间戳防缓存)
    elements.previewImage.src = `/api/assets/${encodeURIComponent(assetId)}/preview?v=${item?.mtime || Date.now()}`;
    elements.previewImage.alt = item?.display_name || assetId;

    // 3. 基础与节点信息初始填充
    if (item) {
      elements.lbMetaDimensions.textContent = `${item.width || 0} × ${item.height || 0}`;
      elements.lbNodeArtist.textContent = item.values?.artist || "未指定";
      elements.lbNodeCharacter.textContent = item.values?.character || "未指定";
      elements.lbNodeGroup.textContent = item.values?.action_group || "未指定";
      elements.lbNodeAction.textContent = item.values?.action || "未指定";

      // Classify 标签
      elements.lbFacetsList.innerHTML = "";
      if (item.facets && Object.keys(item.facets).length > 0) {
        elements.lbFacetsSection.hidden = false;
        for (const [field, vals] of Object.entries(item.facets)) {
          if (Array.isArray(vals) && vals.length > 0) {
            const fieldLabel = FACET_LABELS[field] || field;
            for (const val of vals) {
              const badge = document.createElement("span");
              badge.className = "lb-facet-badge";
              badge.textContent = `${fieldLabel}: ${val}`;
              elements.lbFacetsList.appendChild(badge);
            }
          }
        }
      } else {
        elements.lbFacetsSection.hidden = true;
      }

      if (elements.lbTagsSection) {
        if (item?.tags && item.tags.length > 0 && elements.lbTagsList) {
          elements.lbTagsList.innerHTML = item.tags
            .map((t) => `<span class="lb-tag-badge">🏷️ ${escapeHtml(t)}</span>`)
            .join("");
          elements.lbTagsSection.hidden = false;
        } else {
          elements.lbTagsSection.hidden = true;
        }
      }
    } else {
      elements.lbMetaDimensions.textContent = "-";
      elements.lbNodeArtist.textContent = "-";
      elements.lbNodeCharacter.textContent = "-";
      elements.lbNodeGroup.textContent = "-";
      elements.lbNodeAction.textContent = "-";
      if (elements.lbTagsSection) elements.lbTagsSection.hidden = true;
      elements.lbFacetsSection.hidden = true;
    }

    if (elements.lbSnapshotsList) {
      elements.lbSnapshotsList.innerHTML = '<div class="lb-snapshot-empty">正在加载快照列表...</div>';
    }
    if (elements.lbSnapshotsCount) {
      elements.lbSnapshotsCount.textContent = "";
    }

    if (elements.lbRelatedList) {
      elements.lbRelatedList.innerHTML = '<div class="lb-related-empty">正在检索关联图片...</div>';
    }
    if (elements.lbRelatedTotalCount) elements.lbRelatedTotalCount.textContent = "";
    if (elements.lbRelBadgeBatch) elements.lbRelBadgeBatch.textContent = "(0)";
    if (elements.lbRelBadgeSeed) elements.lbRelBadgeSeed.textContent = "(0)";
    if (elements.lbRelBadgeAdj) elements.lbRelBadgeAdj.textContent = "(0)";
    if (elements.lbRelatedHint) elements.lbRelatedHint.classList.add("hidden");

    // 4. 按钮状态初始同步
    updateLightboxButtonStates(assetId);

    // 5. 并行异步获取：基础生成参数/Prompt (1~2ms瞬开)、关联快照列表、关联图片列表 (互不阻塞)
    loadLightboxBasicDetails(assetId);
    loadLightboxSnapshots(assetId);
    loadLightboxRelated(assetId);
  }

  async function loadLightboxBasicDetails(assetId) {
    try {
      const res = await fetch(`/api/assets/${encodeURIComponent(assetId)}/details?v=${Date.now()}`);
      if (!res.ok) {
        console.error(`[Lightbox] 获取素材生成参数失败 HTTP ${res.status}:`, assetId);
        return;
      }
      if (state.lightbox.activeAssetId === assetId) {
        const detail = await res.json();
        state.lightbox.currentAssetDetails = detail;
        state.loadedAssets.set(assetId, detail);
        elements.lightboxFilename.textContent = detail.display_name || assetId;
        elements.lightboxFilepath.textContent = detail.path || "";
        if (detail.width && detail.height) {
          elements.lbMetaDimensions.textContent = `${detail.width} × ${detail.height} (${detail.image_format || "PNG"})`;
        }

        // 基础生成参数与 Prompt 瞬时填充
        const gen = detail.generation_info || {};
        elements.lbMetaDimensions.textContent = `${detail.width || "-"} × ${detail.height || "-"} (${detail.image_format || "PNG"})`;
        elements.lbMetaSize.textContent = gen.file_size_human || "-";
        elements.lbMetaMtime.textContent = gen.modified_at || "-";
        elements.lbMetaSeed.textContent = gen.seed ?? "-";
        elements.lbMetaModel.textContent = gen.model || "-";
        elements.lbMetaSampler.textContent = gen.sampler || "-";
        elements.lbMetaSteps.textContent = gen.steps ?? "-";
        elements.lbMetaScale.textContent = gen.scale ?? "-";
        elements.lbMetaNoise.textContent = gen.noise_schedule || "-";

        elements.lbPromptBox.textContent = gen.prompt || "无 Prompt 记录";
        elements.lbNegativeBox.textContent = gen.negative_prompt || "无 Negative 记录";

        elements.lbRawParameters.textContent =
          gen.raw_parameters ||
          (gen.all_chunks && Object.keys(gen.all_chunks).length ? JSON.stringify(gen.all_chunks, null, 2) : "无原始参数");

        // 更新投稿与收藏状态
        updateLightboxButtonStates(assetId, detail.is_favorited, detail.is_posted);

        // 渲染筛选标签
        if (detail.tags && detail.tags.length > 0 && elements.lbTagsList && elements.lbTagsSection) {
          elements.lbTagsList.innerHTML = detail.tags
            .map((t) => `<span class="lb-tag-badge">🏷️ ${escapeHtml(t)}</span>`)
            .join("");
          elements.lbTagsSection.hidden = false;
        } else if (elements.lbTagsSection) {
          elements.lbTagsSection.hidden = true;
        }
      }
    } catch (err) {
      console.error("[Lightbox] 加载基础生成参数异常:", err);
    }
  }

  async function loadLightboxSnapshots(assetId) {
    if (!elements.lbSnapshotsList) return;
    try {
      const res = await fetch(`/api/assets/${encodeURIComponent(assetId)}/snapshots?v=${Date.now()}`);
      if (!res.ok) {
        if (state.lightbox.activeAssetId === assetId) {
          elements.lbSnapshotsList.innerHTML = `<div class="lb-snapshot-empty">加载快照列表失败 (HTTP ${res.status})</div>`;
        }
        return;
      }
      if (state.lightbox.activeAssetId === assetId) {
        const data = await res.json();
        const snaps = Array.isArray(data.snapshots) ? data.snapshots : [];
        if (elements.lbSnapshotsCount) {
          elements.lbSnapshotsCount.textContent = `(共 ${snaps.length} 个)`;
        }
        if (snaps.length === 0) {
          elements.lbSnapshotsList.innerHTML = '<div class="lb-snapshot-empty">此图片未关联任何快照</div>';
        } else {
          const currentIds = Array.isArray(state.filters.import_ids) ? state.filters.import_ids : [];
          elements.lbSnapshotsList.innerHTML = snaps.map((s) => {
            const isCurrent = currentIds.includes(s.import_id) || (currentIds.length === 0 && state.filters.import_id === s.import_id);
            const icon = s.source_type === "neev_playlist" ? "📑" : "📁";
            const typeLabel = s.source_type === "neev_playlist" ? "NeeView 列表" : "目录导入";
            const dateStr = s.created_at ? s.created_at.slice(0, 16).replace("T", " ") : "";
            const orderIndex = (s.source_order ?? 0) + 1;
            const totalStr = s.total_items ? ` / 共 ${s.total_items} 张` : "";
            return `
              <div class="lb-snapshot-card ${isCurrent ? "is-active" : ""}">
                <div class="lb-snapshot-header">
                  <div class="lb-snapshot-name-wrap">
                    <span class="lb-snapshot-icon">${icon}</span>
                    <strong class="lb-snapshot-name" title="${escapeHtml(s.source_ref || s.name || s.import_id)}">${escapeHtml(s.name || s.import_id)}</strong>
                  </div>
                  ${isCurrent ? '<span class="lb-snapshot-badge badge-active">📍 当前浏览</span>' : `<span class="lb-snapshot-badge">${typeLabel}</span>`}
                </div>
                <div class="lb-snapshot-meta-row">
                  <span class="lb-snapshot-order">📍 位置: 第 ${orderIndex}${totalStr} (序号 #${s.source_order ?? 0})</span>
                  <span class="lb-snapshot-time">${dateStr}</span>
                </div>
                <div class="lb-snapshot-actions">
                  <button type="button" class="lb-snapshot-jump-btn ${isCurrent ? "btn-active-loc" : ""}" 
                    data-action="jump-snapshot" 
                    data-import-id="${escapeHtml(s.import_id)}" 
                    data-snap-name="${escapeHtml(s.name || s.import_id)}"
                    data-asset-id="${escapeHtml(assetId)}" 
                    data-order="${s.source_order ?? 0}">
                    ${isCurrent ? "🎯 定位当前卡片位置" : "🚀 跳转至此快照并定位"}
                  </button>
                </div>
              </div>
            `;
          }).join("");

          elements.lbSnapshotsList.querySelectorAll('[data-action="jump-snapshot"]').forEach((btn) => {
            btn.addEventListener("click", async (e) => {
              e.stopPropagation();
              const importId = btn.dataset.importId;
              const targetAssetId = btn.dataset.assetId;
              const snapName = btn.dataset.snapName;
              const targetOrder = parseInt(btn.dataset.order, 10) || 0;
              await jumpToSnapshotAndLocate(importId, targetAssetId, snapName, targetOrder);
            });
          });
        }
      }
    } catch (err) {
      console.error("[Lightbox] 加载快照列表异常:", err);
      if (elements.lbSnapshotsList && state.lightbox.activeAssetId === assetId) {
        elements.lbSnapshotsList.innerHTML = '<div class="lb-snapshot-empty">加载快照异常，请刷新重试</div>';
      }
    }
  }

  async function loadLightboxRelated(assetId) {
    if (!elements.lbRelatedList) return;
    try {
      const res = await fetch(`/api/assets/${encodeURIComponent(assetId)}/related?v=${Date.now()}`);
      if (!res.ok) {
        if (state.lightbox.activeAssetId === assetId) {
          elements.lbRelatedList.innerHTML = `<div class="lb-related-empty">加载关联图片失败 (HTTP ${res.status})</div>`;
        }
        return;
      }
      if (state.lightbox.activeAssetId === assetId) {
        const related = await res.json();
        state.lightbox.currentRelated = related;
        const dims = related.dimensions || {};
        const bTotal = dims.same_batch?.total || 0;
        const sTotal = dims.same_seed?.total || 0;
        const aTotal = dims.time_adjacent?.total || 0;
        const totalAll = bTotal + sTotal + aTotal;

        if (elements.lbRelatedTotalCount) {
          elements.lbRelatedTotalCount.textContent = `(共 ${totalAll} 张)`;
        }
        if (elements.lbRelBadgeBatch) elements.lbRelBadgeBatch.textContent = `(${bTotal})`;
        if (elements.lbRelBadgeSeed) elements.lbRelBadgeSeed.textContent = `(${sTotal})`;
        if (elements.lbRelBadgeAdj) elements.lbRelBadgeAdj.textContent = `(${aTotal})`;

        // 自动选择首个有数据的维度页签（优先级：同批 -> 同Seed -> 邻近生图）
        let defaultTab = "same_batch";
        if (bTotal > 0) defaultTab = "same_batch";
        else if (sTotal > 0) defaultTab = "same_seed";
        else if (aTotal > 0) defaultTab = "time_adjacent";

        state.lightbox.currentRelatedActiveTab = defaultTab;
        if (elements.lbRelatedTabs) {
          elements.lbRelatedTabs.querySelectorAll(".lb-rel-tab-btn").forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.relTab === defaultTab);
          });
        }
        renderRelatedDimension(defaultTab);
      }
    } catch (err) {
      console.error("[Lightbox] 加载关联图片异常:", err);
      if (elements.lbRelatedList && state.lightbox.activeAssetId === assetId) {
        elements.lbRelatedList.innerHTML = '<div class="lb-related-empty">加载关联图片异常，请刷新重试</div>';
      }
    }
  }

  function positionHoverPopover(e) {
    if (!elements.lbHoverPreviewPopover) return;
    const popover = elements.lbHoverPreviewPopover;
    const popW = 320;
    const popH = 320;
    const padding = 16;
    let x = e.clientX - popW - padding;
    let y = e.clientY - (popH / 2);

    if (x < padding) {
      x = e.clientX + padding;
    }
    if (y < padding) y = padding;
    if (y + popH > window.innerHeight - padding) {
      y = window.innerHeight - popH - padding;
    }

    popover.style.left = `${x}px`;
    popover.style.top = `${y}px`;
  }

  let activePeekCleanup = null;

  function startHoldPeek(targetAssetId, targetDisplayName) {
    if (!elements.previewImage) return;
    if (activePeekCleanup) {
      activePeekCleanup();
    }

    const originalSrc = elements.previewImage.src;
    const targetUrl = `/api/assets/${encodeURIComponent(targetAssetId)}/preview?v=${Date.now()}`;

    // 临时隐藏悬浮放大镜
    if (elements.lbHoverPreviewPopover) {
      elements.lbHoverPreviewPopover.classList.add("hidden");
    }

    elements.previewImage.src = targetUrl;

    const imgArea = elements.previewImage.closest(".lightbox-image-area") || elements.previewImage.parentElement;
    let banner = document.getElementById("lb-peek-banner");
    if (!banner && imgArea) {
      banner = document.createElement("div");
      banner.id = "lb-peek-banner";
      banner.className = "lb-peek-indicator-banner";
      imgArea.appendChild(banner);
    }
    if (banner) {
      banner.innerHTML = `<span>👁️ 正在对比: <strong>${escapeHtml(targetDisplayName || targetAssetId)}</strong></span> <span style="font-size:11px;opacity:0.85;margin-left:4px;">(松开鼠标恢复原图)</span>`;
    }

    const stopHoldPeek = () => {
      elements.previewImage.src = originalSrc;
      const b = document.getElementById("lb-peek-banner");
      if (b) b.remove();
      document.querySelectorAll(".lb-thumb-peek-badge.active, .lb-rel-peek-btn.active").forEach((el) => el.classList.remove("active"));
      window.removeEventListener("mouseup", stopHoldPeek);
      window.removeEventListener("touchend", stopHoldPeek);
      window.removeEventListener("blur", stopHoldPeek);
      activePeekCleanup = null;
    };

    window.addEventListener("mouseup", stopHoldPeek);
    window.addEventListener("touchend", stopHoldPeek);
    window.addEventListener("blur", stopHoldPeek);
    activePeekCleanup = stopHoldPeek;
  }

  function renderRelatedDimension(dimKey) {
    if (!elements.lbRelatedList) return;
    const rel = state.lightbox.currentRelated;
    const dims = rel?.dimensions || {};
    const dim = dims[dimKey] || { items: [], total: 0 };
    const items = Array.isArray(dim.items) ? dim.items : [];

    const viewMode = state.lightbox.relatedViewMode || "grid";
    elements.lbRelatedList.className = `lb-related-list view-${viewMode}`;

    if (elements.lbRelatedViewToggles) {
      elements.lbRelatedViewToggles.querySelectorAll(".lb-view-toggle-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.view === viewMode);
      });
    }

    if (items.length === 0) {
      elements.lbRelatedList.innerHTML = '<div class="lb-related-empty">暂无该维度的关联图片</div>';
      if (elements.lbRelatedHint) elements.lbRelatedHint.classList.add("hidden");
      return;
    }

    const currentIds = Array.isArray(state.filters.import_ids) ? state.filters.import_ids : [];
    const currentSnapId = currentIds[0] || state.filters.import_id || "";

    elements.lbRelatedList.innerHTML = items.map((item) => {
      const snaps = Array.isArray(item.snapshots) ? item.snapshots : [];
      const dimsText = item.width && item.height ? `${item.width}×${item.height}` : "";
      const labelBadge = item.relation_label ? `<span class="lb-related-tag-badge">${escapeHtml(item.relation_label)}</span>` : "";

      // 快照徽章 chips
      const snapChipsHtml = snaps.map((s) => {
        const isCur = s.import_id === currentSnapId || currentIds.includes(s.import_id);
        const orderIdx = (s.source_order ?? 0) + 1;
        return `<span class="lb-related-snap-chip" title="点击跳转至快照【${escapeHtml(s.name || s.import_id)}】第 ${orderIdx} 张"
          data-action="jump-rel-snap"
          data-import-id="${escapeHtml(s.import_id)}"
          data-snap-name="${escapeHtml(s.name || s.import_id)}"
          data-asset-id="${escapeHtml(item.asset_id)}"
          data-order="${s.source_order ?? 0}">
          📁 ${escapeHtml(s.name || s.import_id)} #${orderIdx}${isCur ? " 📍" : ""}
        </span>`;
      }).join("");

      // 跳转按钮
      let jumpBtnHtml = "";
      if (snaps.length === 1) {
        const s = snaps[0];
        const isCur = s.import_id === currentSnapId || currentIds.includes(s.import_id);
        jumpBtnHtml = `
          <button type="button" class="lb-rel-jump-btn"
            data-action="jump-rel-snap"
            data-import-id="${escapeHtml(s.import_id)}"
            data-snap-name="${escapeHtml(s.name || s.import_id)}"
            data-asset-id="${escapeHtml(item.asset_id)}"
            data-order="${s.source_order ?? 0}">
            ${isCur ? "🎯 定位" : "🚀 跳转"}
          </button>
        `;
      } else if (snaps.length > 1) {
        jumpBtnHtml = `
          <button type="button" class="lb-rel-jump-btn" data-action="toggle-rel-popover">
            🚀 跳转 (${snaps.length}) ▾
          </button>
        `;
      }

      return `
        <div class="lb-related-card" data-asset-id="${escapeHtml(item.asset_id)}">
          <div class="lb-related-thumb-wrap" data-action="view-related" data-asset-id="${escapeHtml(item.asset_id)}" title="点击查看详情">
            <img class="lb-related-thumb-img" src="/api/assets/${encodeURIComponent(item.asset_id)}/preview?v=${Date.now()}" alt="${escapeHtml(item.display_name)}" loading="lazy">
            <button type="button" class="lb-thumb-peek-badge" data-action="hold-peek" data-asset-id="${escapeHtml(item.asset_id)}" title="按住可在左侧大图临时对比">👁️ 对比</button>
          </div>
          <div class="lb-related-info">
            <strong class="lb-related-name" data-action="view-related" data-asset-id="${escapeHtml(item.asset_id)}" title="${escapeHtml(item.display_name)}">${escapeHtml(item.display_name)}</strong>
            <div class="lb-related-meta-row">
              ${labelBadge}
              ${dimsText ? `<span>${dimsText}</span>` : ""}
            </div>
            ${snaps.length > 0 ? `<div class="lb-related-snaps-row">${snapChipsHtml}</div>` : ""}
          </div>
          <div class="lb-related-actions">
            <button type="button" class="lb-rel-view-btn" data-action="view-related" data-asset-id="${escapeHtml(item.asset_id)}" title="查看该图片详情（可按顶部返回切回）">🔍 查看</button>
            <button type="button" class="lb-rel-peek-btn" data-action="hold-peek" data-asset-id="${escapeHtml(item.asset_id)}" title="按住可在左侧大图临时对比">👁️ 对比</button>
            ${jumpBtnHtml}
          </div>
        </div>
      `;
    }).join("");

    // 绑定查看事件 (进入历史栈)
    elements.lbRelatedList.querySelectorAll('[data-action="view-related"]').forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target.closest('[data-action="hold-peek"]')) return;
        e.stopPropagation();
        const targetId = el.dataset.assetId || el.closest("[data-asset-id]")?.dataset.assetId;
        if (targetId) {
          openLightbox(targetId, null, { pushHistory: true });
        }
      });
    });

    // 绑定悬浮大图放大镜 (Hover Popover)
    elements.lbRelatedList.querySelectorAll(".lb-related-card").forEach((card) => {
      const assetId = card.dataset.assetId;
      const targetItem = items.find((it) => it.asset_id === assetId);
      if (!targetItem) return;

      const thumbWrap = card.querySelector(".lb-related-thumb-wrap");
      const targetPreviewUrl = `/api/assets/${encodeURIComponent(assetId)}/preview?v=${Date.now()}`;

      if (thumbWrap) {
        thumbWrap.addEventListener("mouseenter", (e) => {
          if (!elements.lbHoverPreviewPopover) return;
          if (activePeekCleanup) return; // 对比进行中不弹窗
          elements.lbHoverPreviewPopover.innerHTML = `<img src="${targetPreviewUrl}" alt="${escapeHtml(targetItem.display_name)}" />`;
          elements.lbHoverPreviewPopover.classList.remove("hidden");
          positionHoverPopover(e);
        });
        thumbWrap.addEventListener("mousemove", (e) => {
          if (activePeekCleanup) {
            if (elements.lbHoverPreviewPopover) elements.lbHoverPreviewPopover.classList.add("hidden");
            return;
          }
          positionHoverPopover(e);
        });
        thumbWrap.addEventListener("mouseleave", () => {
          if (elements.lbHoverPreviewPopover) {
            elements.lbHoverPreviewPopover.classList.add("hidden");
          }
        });
      }
    });

    // 绑定按住临时对比 (Hold to Peek)
    elements.lbRelatedList.querySelectorAll('[data-action="hold-peek"]').forEach((btn) => {
      const aid = btn.dataset.assetId;
      const targetItem = items.find((it) => it.asset_id === aid);
      const dName = targetItem?.display_name || aid;

      const handlePress = (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        btn.classList.add("active");
        startHoldPeek(aid, dName);
      };

      btn.addEventListener("mousedown", handlePress);
      btn.addEventListener("touchstart", handlePress, { passive: false });
    });

    elements.lbRelatedList.querySelectorAll('[data-action="jump-rel-snap"]').forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const importId = btn.dataset.importId;
        const targetAssetId = btn.dataset.assetId;
        const snapName = btn.dataset.snapName;
        const targetOrder = parseInt(btn.dataset.order, 10) || 0;
        await jumpToSnapshotAndLocate(importId, targetAssetId, snapName, targetOrder);
      });
    });

    elements.lbRelatedList.querySelectorAll('[data-action="toggle-rel-popover"]').forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const card = btn.closest(".lb-related-card");
        if (!card) return;
        const assetId = card.dataset.assetId;
        const targetItem = items.find((it) => it.asset_id === assetId);
        if (!targetItem || !targetItem.snapshots) return;

        const existing = card.querySelector(".lb-rel-popover");
        if (existing) {
          existing.remove();
          return;
        }

        document.querySelectorAll(".lb-rel-popover").forEach((p) => p.remove());

        const popover = document.createElement("div");
        popover.className = "lb-rel-popover";
        popover.innerHTML = targetItem.snapshots.map((s) => {
          const orderIdx = (s.source_order ?? 0) + 1;
          return `
            <div class="lb-rel-popover-item"
              data-import-id="${escapeHtml(s.import_id)}"
              data-snap-name="${escapeHtml(s.name || s.import_id)}"
              data-asset-id="${escapeHtml(targetItem.asset_id)}"
              data-order="${s.source_order ?? 0}">
              <span>📁 ${escapeHtml(s.name || s.import_id)}</span>
              <span style="color:#fbbf24;font-size:10px;">#${orderIdx}</span>
            </div>
          `;
        }).join("");

        popover.querySelectorAll(".lb-rel-popover-item").forEach((itemEl) => {
          itemEl.addEventListener("click", async (evt) => {
            evt.stopPropagation();
            popover.remove();
            const importId = itemEl.dataset.importId;
            const targetAssetId = itemEl.dataset.assetId;
            const snapName = itemEl.dataset.snapName;
            const targetOrder = parseInt(itemEl.dataset.order, 10) || 0;
            await jumpToSnapshotAndLocate(importId, targetAssetId, snapName, targetOrder);
          });
        });

        card.appendChild(popover);
      });
    });

    if (elements.lbRelatedHint) {
      if (dimKey === "time_adjacent" && dim.total > items.length) {
        elements.lbRelatedHint.textContent = `共 ${dim.total} 张，已展示时间最近的前 ${items.length} 张`;
        elements.lbRelatedHint.classList.remove("hidden");
      } else {
        elements.lbRelatedHint.classList.add("hidden");
      }
    }
  }

  function updateLightboxButtonStates(assetId, serverFav = null, serverPosted = null) {
    const isFav = serverFav !== null ? serverFav : isAssetFavorited(assetId);
    elements.lightboxFavoriteBtn.classList.toggle("active-fav", isFav);
    elements.lightboxFavLabel.textContent = isFav ? "已收藏 ⭐" : "收藏 ☆";

    const item = state.loadedAssets.get(assetId);
    const realUsage = (item?.usage || []).filter(u => u !== "favorite");
    const isPosted = serverPosted !== null ? serverPosted : realUsage.length > 0;
    elements.lightboxPostedBtn.classList.toggle("active-posted", isPosted);
    elements.lightboxPostedLabel.textContent = isPosted ? "已投稿 📮" : "标记已投稿 📥";
  }

  // ================= Submission 编辑器 =================

  async function loadHistoricalSubmissions() {
    try {
      const res = await fetch("/api/submissions");
      if (res.ok) {
        state.historicalSubmissions = await res.json();
        elements.historySubmissionSelect.innerHTML = '<option value="">-- 选择历史投稿进行编辑 --</option>';
        for (const sub of state.historicalSubmissions) {
          const opt = document.createElement("option");
          opt.value = sub.task_id;
          const postCount = sub.counts && typeof sub.counts.post === "number" ? ` (${sub.counts.post}图)` : "";
          const pixivPrefix = sub.pixiv?.illust_id ? "✓ " : "";
          const pixivSuffix = sub.pixiv?.illust_id ? ` [PID:${sub.pixiv.illust_id}]` : "";
          opt.textContent = `${pixivPrefix}${sub.title || sub.task_id}${postCount}${pixivSuffix}`;
          elements.historySubmissionSelect.appendChild(opt);
        }
      }
    } catch (err) {
      console.warn("加载历史投稿列表失败", err);
    }
  }

  async function loadSubmissionDetail(taskId) {
    clearNotice();
    try {
      const res = await fetch(`/api/submissions/${encodeURIComponent(taskId)}`);
      if (!res.ok) {
        throw new Error(`加载投稿详情失败 (${res.status})`);
      }
      const data = await res.json();
      state.currentSubmission = {
        task_id: data.task_id,
        title: data.title || "",
        source_import_id: data.source_import_id || null,
        revision: data.revision || 1,
        sets: {
          all: data.sets?.all || [],
          post: data.sets?.post || [],
          cover: data.sets?.cover || [],
        },
        pixiv: data.pixiv ? {
          title: data.pixiv.title || data.title || "",
          caption: data.pixiv.caption || "",
          tags: Array.isArray(data.pixiv.tags) ? [...data.pixiv.tags] : [],
          suggested_tags: Array.isArray(data.pixiv.suggested_tags) ? [...data.pixiv.suggested_tags] : [],
          r18: data.pixiv.r18 !== false,
          allow_tag_edit: data.pixiv.allow_tag_edit !== false,
          crop_x: data.pixiv.crop_x != null ? Number(data.pixiv.crop_x) : null,
          crop_y: data.pixiv.crop_y != null ? Number(data.pixiv.crop_y) : null,
          illust_id: data.pixiv.illust_id || null,
          published_at: data.pixiv.published_at || null,
          last_publish_status: data.pixiv.last_publish_status || null,
          last_publish_error: data.pixiv.last_publish_error || null,
        } : {
          title: data.title || "",
          caption: "",
          tags: [],
          suggested_tags: [],
          r18: true,
          allow_tag_edit: true,
          crop_x: null,
          crop_y: null,
          illust_id: null,
          published_at: null,
          last_publish_status: null,
          last_publish_error: null,
        },
        scheduled_at: data.scheduled_at || null,
        scheduled_publish: Boolean(data.scheduled_publish),
        allow_delay: Boolean(data.allow_delay),
        max_delay_minutes: Number(data.max_delay_minutes || 240),
        currentSetTab: "all",
        legacyInlineSource: null,
      };
      state.tagSuggestions.pixiv = state.currentSubmission.pixiv.suggested_tags || [];
      elements.legacyConvertBanner.classList.add("hidden");

      if (data.scheduled_at) {
        const [dPart, tPart] = data.scheduled_at.split("T");
        if (elements.submissionDate) elements.submissionDate.value = dPart || "";
        if (elements.submissionTime && tPart) {
          elements.submissionTime.value = tPart.slice(0, 5) || "20:00";
        }
      } else {
        if (elements.submissionDate) elements.submissionDate.value = "";
        if (elements.submissionTime) elements.submissionTime.value = "20:00";
      }

      syncSubmissionFormUI();
      checkLastExportForTask(taskId);
      // 提取推荐标签（不覆盖标题或已有标签）
      fetchMetadataSuggestions(data.sets?.all || [], false);
    } catch (err) {
      showNotice(err.message, "error");
    }
  }

  function resetSubmissionEditor() {
    state.currentSubmission = {
      task_id: null,
      title: "",
      source_import_id: state.filters.import_id || null,
      revision: 1,
      sets: { all: [], post: [], cover: [] },
      pixiv: {
        title: "",
        caption: "",
        tags: [],
        suggested_tags: [],
        r18: true,
        allow_tag_edit: true,
        crop_x: null,
        crop_y: null,
        illust_id: null,
        published_at: null,
        last_publish_status: null,
        last_publish_error: null,
      },
      scheduled_at: null,
      scheduled_publish: false,
      allow_delay: false,
      max_delay_minutes: 240,
      currentSetTab: "all",
      legacyInlineSource: null,
    };
    state.tagSuggestions = { preset: [], character: [], action: [], pixiv: [] };
    elements.legacyConvertBanner.classList.add("hidden");
    elements.historySubmissionSelect.value = "";
    if (elements.submissionDate) elements.submissionDate.value = "";
    if (elements.submissionTime) elements.submissionTime.value = "20:00";
    if (elements.exportMosaicToggle) {
      elements.exportMosaicToggle.checked = true;
    }
    if (elements.exportMosaicParams) {
      elements.exportMosaicParams.classList.remove("hidden");
    }
    const defaultMosaicSize = localStorage.getItem("export_mosaic_pixel_size") || "10";
    if (elements.exportMosaicPixelSize) {
      elements.exportMosaicPixelSize.value = defaultMosaicSize;
    }
    if (elements.exportMosaicPixelVal) {
      elements.exportMosaicPixelVal.textContent = `${defaultMosaicSize}px`;
    }
    syncSubmissionFormUI();
    resetExportUI();
  }

  function syncSubmissionFormUI() {
    const sub = state.currentSubmission;
    elements.submissionEditorTitle.textContent = sub.task_id ? "编辑投稿" : "新建投稿";
    elements.submissionTitle.value = sub.title;
    elements.submissionTaskBadge.textContent = sub.task_id ? sub.task_id : "未生成任务";
    elements.submissionRevBadge.textContent = `Rev ${sub.revision}`;

    // 更新 Tab 按钮与角标
    elements.badgeCountAll.textContent = String(sub.sets.all.length);
    elements.badgeCountPost.textContent = String(sub.sets.post.length);
    elements.badgeCountCover.textContent = String(sub.sets.cover.length);

    elements.tabAll.classList.toggle("active", sub.currentSetTab === "all");
    elements.tabPost.classList.toggle("active", sub.currentSetTab === "post");
    elements.tabCover.classList.toggle("active", sub.currentSetTab === "cover");

    elements.startExportBtn.disabled = !sub.task_id;
    if (elements.deleteSubmissionBtn) {
      elements.deleteSubmissionBtn.classList.toggle("hidden", !sub.task_id);
    }

    renderPixivMetadataUI();
    renderSetItems();
  }

  // ================= Pixiv 投稿元数据与推荐标签 =================

  async function fetchMetadataSuggestions(assetIds, isNew = false) {
    if (!assetIds || !assetIds.length) {
      state.tagSuggestions = { preset: [], character: [], action: [], pixiv: [] };
      renderPixivMetadataUI();
      return;
    }
    try {
      const res = await fetch("/api/submissions/generate-metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset_ids: assetIds,
          import_id: state.filters.import_id || null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        // 仅在新建投稿且标题未被用户输入时自动填充标题
        if (isNew && (!state.currentSubmission.title || !state.currentSubmission.title.trim())) {
          if (data.title) {
            state.currentSubmission.title = data.title;
            if (elements.submissionTitle) elements.submissionTitle.value = data.title;
          }
        }
        // 如果 pixiv.caption 为空，填充默认 caption
        if (isNew && (!state.currentSubmission.pixiv.caption || !state.currentSubmission.pixiv.caption.trim())) {
          if (data.caption) {
            state.currentSubmission.pixiv.caption = data.caption;
            if (elements.pixivCaption) elements.pixivCaption.value = data.caption;
          }
        }
        state.tagSuggestions = {
          preset: data.tag_suggestions?.preset || [],
          character: data.tag_suggestions?.character || [],
          action: data.tag_suggestions?.action || [],
          pixiv: state.tagSuggestions?.pixiv || [],
        };
        renderPixivMetadataUI();
      }
    } catch (err) {
      console.warn("生成元数据建议失败", err);
    }
  }

  function addPixivTag(tagText) {
    const text = String(tagText || "").trim();
    if (!text) return;
    const currentTags = state.currentSubmission.pixiv.tags || [];
    if (currentTags.includes(text)) return;
    if (currentTags.length >= 10) {
      showNotice("Pixiv 投稿最多支持 10 个标签", "warning");
      return;
    }
    currentTags.push(text);
    state.currentSubmission.pixiv.tags = currentTags;
    renderPixivMetadataUI();
  }

  function removePixivTag(tagText) {
    const text = String(tagText || "").trim();
    const currentTags = state.currentSubmission.pixiv.tags || [];
    state.currentSubmission.pixiv.tags = currentTags.filter((t) => t !== text);
    renderPixivMetadataUI();
  }

  function renderPixivMetadataUI() {
    const pix = state.currentSubmission.pixiv || {
      title: "",
      caption: "",
      tags: [],
      r18: true,
      allow_tag_edit: true,
    };
    if (elements.pixivCaption) elements.pixivCaption.value = pix.caption || "";
    if (elements.pixivR18) elements.pixivR18.checked = pix.r18 !== false;
    if (elements.pixivAllowTagEdit) elements.pixivAllowTagEdit.checked = pix.allow_tag_edit !== false;

    const selectedTags = Array.isArray(pix.tags) ? pix.tags : [];
    if (elements.pixivTagsCount) {
      elements.pixivTagsCount.textContent = `(${selectedTags.length}/10)`;
      elements.pixivTagsCount.style.color = selectedTags.length >= 10 ? "#ef4444" : "#64748b";
    }

    // 渲染已选标签
    if (elements.pixivSelectedTags) {
      elements.pixivSelectedTags.innerHTML = "";
      if (!selectedTags.length) {
        elements.pixivSelectedTags.innerHTML = '<span class="helper-text" style="font-size:11px;color:#94a3b8;">暂无标签，可点击下方推荐或手动添加</span>';
      } else {
        for (const tag of selectedTags) {
          const chip = document.createElement("span");
          chip.className = "pixiv-tag-chip";
          chip.innerHTML = `${escapeHtml(tag)} <button type="button" class="pixiv-tag-chip-remove" title="移除标签">×</button>`;
          chip.querySelector(".pixiv-tag-chip-remove").addEventListener("click", (e) => {
            e.stopPropagation();
            removePixivTag(tag);
          });
          elements.pixivSelectedTags.appendChild(chip);
        }
      }
    }

    // 渲染推荐候选池
    renderRecommendCategory(elements.recommendPresetTags, state.tagSuggestions?.preset || [], selectedTags);
    renderRecommendCategory(elements.recommendCharTags, state.tagSuggestions?.character || [], selectedTags);
    renderRecommendCategory(elements.recommendActionTags, state.tagSuggestions?.action || [], selectedTags);
    renderRecommendCategory(elements.recommendPixivOnlineTags, state.tagSuggestions?.pixiv || [], selectedTags);

    // 渲染 Pixiv 发布状态与按钮
    const sub = state.currentSubmission;
    if (elements.submissionPixivBadge) {
      if (pix.illust_id) {
        elements.submissionPixivBadge.classList.remove("hidden");
        elements.submissionPixivBadge.className = "meta-badge meta-badge-pixiv published";
        elements.submissionPixivBadge.innerHTML = `<a href="https://www.pixiv.net/artworks/${encodeURIComponent(pix.illust_id)}" target="_blank">✓ Pixiv: PID ${escapeHtml(pix.illust_id)} ↗</a>`;
      } else if (sub.scheduled_publish) {
        elements.submissionPixivBadge.classList.remove("hidden");
        elements.submissionPixivBadge.className = "meta-badge meta-badge-pixiv scheduled";
        elements.submissionPixivBadge.innerHTML = `⏰ 定时: ${sub.scheduled_at ? escapeHtml(sub.scheduled_at.slice(5, 16).replace("T", " ")) : "排期中"}`;
      } else {
        elements.submissionPixivBadge.classList.add("hidden");
      }
    }

    if (elements.pixivPublishStatusBox && elements.publishToPixivBtn) {
      if (pix.illust_id) {
        elements.pixivPublishStatusBox.classList.remove("hidden");
        elements.pixivPublishStatusBox.className = "pixiv-publish-status-box published";
        const pubTimeDisplay = pix.published_at ? `实际发布时间: ${formatPublishedAt(pix.published_at)}` : "";
        elements.pixivPublishStatusBox.innerHTML = `<span>✓ 已发布到 Pixiv：<a href="https://www.pixiv.net/artworks/${encodeURIComponent(pix.illust_id)}" target="_blank" class="pixiv-pid-link">PID: ${escapeHtml(pix.illust_id)} ↗</a></span><span class="helper-text" style="font-size:12px;font-weight:500;">${escapeHtml(pubTimeDisplay)}</span>`;
        elements.publishToPixivBtn.textContent = `✓ 已发布 (PID: ${pix.illust_id})`;
        elements.publishToPixivBtn.disabled = true;
        if (elements.republishToPixivBtn) {
          elements.republishToPixivBtn.classList.remove("hidden");
        }
      } else {
        elements.pixivPublishStatusBox.classList.add("hidden");
        elements.publishToPixivBtn.textContent = "🚀 发布到 Pixiv";
        elements.publishToPixivBtn.disabled = !sub.task_id;
        if (elements.republishToPixivBtn) {
          elements.republishToPixivBtn.classList.add("hidden");
        }
      }
    }

    if (elements.scheduleAllowDelayCheckbox) {
      elements.scheduleAllowDelayCheckbox.checked = Boolean(sub.allow_delay);
    }
    if (elements.scheduleDelayMinutesInput) {
      elements.scheduleDelayMinutesInput.value = sub.allow_delay ? (sub.max_delay_minutes || 240) : 240;
    }

    if (elements.schedulePixivBtn) {
      elements.schedulePixivBtn.disabled = !sub.task_id;
      if (sub.scheduled_publish) {
        elements.schedulePixivBtn.textContent = "⏹ 取消定时发布";
        elements.schedulePixivBtn.classList.add("active");
        if (elements.pixivScheduleStatusBox) {
          elements.pixivScheduleStatusBox.classList.remove("hidden");
          elements.pixivScheduleStatusBox.className = "pixiv-schedule-status-box active";
          const timeWindow = formatScheduleTimeWindow(sub.scheduled_at, sub.allow_delay, sub.max_delay_minutes);
          const delayTag = sub.allow_delay && sub.max_delay_minutes > 0 ? "" : " (准时)";
          elements.pixivScheduleStatusBox.innerHTML = `<span>⏰ 定时发布中${delayTag}：将于 <strong>${escapeHtml(timeWindow)}</strong> 自动发布</span>`;
        }
      } else {
        elements.schedulePixivBtn.textContent = "⏰ 开启定时发布";
        elements.schedulePixivBtn.classList.remove("active");
        if (elements.pixivScheduleStatusBox) {
          elements.pixivScheduleStatusBox.classList.add("hidden");
        }
      }
    }

    updatePixivThumbnailPreview();
  }

  function formatPublishedAt(isoStr) {
    if (!isoStr) return "";
    try {
      const dt = new Date(isoStr);
      if (isNaN(dt.getTime())) {
        return String(isoStr).slice(0, 19).replace("T", " ");
      }
      const pad = (n) => String(n).padStart(2, "0");
      return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
    } catch (_) {
      return String(isoStr).slice(0, 19).replace("T", " ");
    }
  }

  function formatScheduleTimeWindow(scheduledAtStr, allowDelay, maxDelayMinutes) {
    if (!scheduledAtStr) return "排期时间";
    try {
      const dt = new Date(scheduledAtStr);
      if (isNaN(dt.getTime())) {
        return scheduledAtStr.slice(0, 16).replace("T", " ");
      }
      const pad = (n) => String(n).padStart(2, "0");
      const fmt = (d) =>
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

      const startStr = fmt(dt);
      if (allowDelay && maxDelayMinutes > 0) {
        const endDt = new Date(dt.getTime() + maxDelayMinutes * 60 * 1000);
        const endStr = fmt(endDt);
        return `${startStr} - ${endStr}`;
      }
      return startStr;
    } catch (e) {
      return scheduledAtStr.slice(0, 16).replace("T", " ");
    }
  }

  function renderRecommendCategory(container, list, selectedTags) {
    if (!container) return;
    container.innerHTML = "";
    if (!list || !list.length) {
      container.innerHTML = '<span class="helper-text" style="font-size:10px;color:#cbd5e1;">(无候选)</span>';
      return;
    }
    for (const tag of list) {
      const isAdded = selectedTags.includes(tag);
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `recommend-chip ${isAdded ? "added" : ""}`;
      chip.textContent = isAdded ? `✓ ${tag}` : `+ ${tag}`;
      chip.title = isAdded ? "已添加到标签" : "点击添加到标签";
      if (!isAdded) {
        chip.addEventListener("click", () => addPixivTag(tag));
      }
      container.appendChild(chip);
    }
  }

  // ================= Pixiv 1:1 缩略图范围裁剪与实时预览 =================

  const cropState = {
    coverAssetId: null,
    imgUrl: null,
    width: 0,
    height: 0,
    orientation: "vertical", // "vertical" | "horizontal" | "square"
    maxCropX: 0,
    maxCropY: 0,
    tempCropX: 0,
    tempCropY: 0,
    isDragging: false,
    startX: 0,
    startY: 0,
    startCropX: 0,
    startCropY: 0,
  };

  function getSubmissionCoverAssetId() {
    const sets = state.currentSubmission.sets || { all: [], post: [], cover: [] };
    if (sets.cover && sets.cover.length > 0) return sets.cover[0];
    if (sets.all && sets.all.length > 0) return sets.all[0];
    if (sets.post && sets.post.length > 0) return sets.post[0];
    return null;
  }

  function updatePixivThumbnailPreview() {
    const assetId = getSubmissionCoverAssetId();
    if (!assetId) {
      if (elements.pixivThumbPreviewBox) elements.pixivThumbPreviewBox.classList.add("hidden");
      if (elements.pixivThumbEmptyBox) elements.pixivThumbEmptyBox.classList.remove("hidden");
      if (elements.openPixivCropBtn) elements.openPixivCropBtn.disabled = true;
      if (elements.pixivCropResetBtn) elements.pixivCropResetBtn.disabled = true;
      if (elements.pixivThumbDimensions) elements.pixivThumbDimensions.textContent = "- × -";
      if (elements.pixivThumbCropStatus) elements.pixivThumbCropStatus.textContent = "未选择素材";
      if (elements.pixivThumbOrientationBadge) {
        elements.pixivThumbOrientationBadge.textContent = "无素材";
        elements.pixivThumbOrientationBadge.className = "pixiv-thumb-badge";
      }
      return;
    }

    if (elements.pixivThumbPreviewBox) elements.pixivThumbPreviewBox.classList.remove("hidden");
    if (elements.pixivThumbEmptyBox) elements.pixivThumbEmptyBox.classList.add("hidden");
    if (elements.openPixivCropBtn) elements.openPixivCropBtn.disabled = false;
    if (elements.pixivCropResetBtn) elements.pixivCropResetBtn.disabled = false;

    const previewUrl = `/api/assets/${encodeURIComponent(assetId)}/preview`;
    const img = elements.pixivThumbPreviewImg;
    if (!img) return;

    const applyStyles = (naturalW, naturalH) => {
      const W = naturalW || 1;
      const H = naturalH || 1;
      const isHorizontal = W > H;
      const isVertical = H > W;

      if (elements.pixivThumbDimensions) {
        elements.pixivThumbDimensions.textContent = `${W} × ${H}`;
      }

      if (isHorizontal) {
        if (elements.pixivThumbOrientationBadge) {
          elements.pixivThumbOrientationBadge.textContent = "横图";
          elements.pixivThumbOrientationBadge.className = "pixiv-thumb-badge horizontal";
        }
        const maxCropX = (W - H) / W;
        const defaultCropX = (W - H) / (2 * W);
        const cropX = state.currentSubmission.pixiv?.crop_x != null ? Number(state.currentSubmission.pixiv.crop_x) : defaultCropX;
        const clampedCropX = Math.max(0, Math.min(maxCropX, cropX));

        img.style.height = "100%";
        img.style.width = "auto";
        img.style.maxWidth = "none";
        img.style.maxHeight = "none";
        img.style.transform = `translateX(-${(clampedCropX * 100).toFixed(4)}%)`;

        if (elements.pixivThumbCropStatus) {
          const isCustom = state.currentSubmission.pixiv?.crop_x != null;
          elements.pixivThumbCropStatus.textContent = isCustom
            ? `自定义 (X: ${(clampedCropX * 100).toFixed(1)}%)`
            : `官方居中 (X: ${(defaultCropX * 100).toFixed(1)}%)`;
        }
      } else if (isVertical) {
        if (elements.pixivThumbOrientationBadge) {
          elements.pixivThumbOrientationBadge.textContent = "竖图";
          elements.pixivThumbOrientationBadge.className = "pixiv-thumb-badge";
        }
        const maxCropY = (H - W) / H;
        const defaultCropY = 0;
        const cropY = state.currentSubmission.pixiv?.crop_y != null ? Number(state.currentSubmission.pixiv.crop_y) : defaultCropY;
        const clampedCropY = Math.max(0, Math.min(maxCropY, cropY));

        img.style.width = "100%";
        img.style.height = "auto";
        img.style.maxWidth = "none";
        img.style.maxHeight = "none";
        img.style.transform = `translateY(-${(clampedCropY * 100).toFixed(4)}%)`;

        if (elements.pixivThumbCropStatus) {
          const isCustom = state.currentSubmission.pixiv?.crop_y != null;
          elements.pixivThumbCropStatus.textContent = isCustom
            ? `自定义 (Y: ${(clampedCropY * 100).toFixed(1)}%)`
            : `官方置顶 (Y: 0.0%)`;
        }
      } else {
        if (elements.pixivThumbOrientationBadge) {
          elements.pixivThumbOrientationBadge.textContent = "正方形";
          elements.pixivThumbOrientationBadge.className = "pixiv-thumb-badge";
        }
        img.style.width = "100%";
        img.style.height = "100%";
        img.style.maxWidth = "none";
        img.style.maxHeight = "none";
        img.style.transform = "none";
        if (elements.pixivThumbCropStatus) {
          elements.pixivThumbCropStatus.textContent = "正方形 (全图居中)";
        }
      }
    };

    const cachedAsset = state.loadedAssets.get(assetId);
    if (cachedAsset && cachedAsset.width && cachedAsset.height) {
      img.src = previewUrl;
      applyStyles(cachedAsset.width, cachedAsset.height);
    } else {
      img.src = previewUrl;
      img.onload = () => {
        applyStyles(img.naturalWidth, img.naturalHeight);
      };
    }
  }

  function openPixivCropDialog() {
    const assetId = getSubmissionCoverAssetId();
    if (!assetId || !elements.pixivCropDialog) {
      showNotice("请先选择至少一张素材作为封面图", "warning");
      return;
    }

    const previewUrl = `/api/assets/${encodeURIComponent(assetId)}/preview`;
    cropState.coverAssetId = assetId;
    cropState.imgUrl = previewUrl;

    const setupDialog = (W, H) => {
      cropState.width = W;
      cropState.height = H;
      const isHorizontal = W > H;
      const isVertical = H > W;

      if (isHorizontal) {
        cropState.orientation = "horizontal";
        cropState.maxCropX = (W - H) / W;
        cropState.maxCropY = 0;
        const defaultX = (W - H) / (2 * W);
        cropState.tempCropX = state.currentSubmission.pixiv?.crop_x != null ? Number(state.currentSubmission.pixiv.crop_x) : defaultX;
        cropState.tempCropY = 0;

        if (elements.cropModalSubtitle) {
          elements.cropModalSubtitle.textContent = `当前为横图 (${W}×${H})，裁切正方形边长为 ${H}px，可左右拖动或滑动调整`;
        }
        if (elements.cropDragHintText) elements.cropDragHintText.textContent = "🖐️ 鼠标按住左右拖拽平移";
        if (elements.cropSliderStartLabel) elements.cropSliderStartLabel.textContent = "左端";
        if (elements.cropSliderEndLabel) elements.cropSliderEndLabel.textContent = "右端";
        if (elements.cropPresetStartBtn) elements.cropPresetStartBtn.textContent = "⬅️ 置左";
        if (elements.cropPresetCenterBtn) elements.cropPresetCenterBtn.textContent = "🎯 居中";
        if (elements.cropPresetEndBtn) elements.cropPresetEndBtn.textContent = "➡️ 置右";
        if (elements.cropRangeSlider) {
          elements.cropRangeSlider.disabled = false;
          elements.cropRangeSlider.value = cropState.maxCropX > 0 ? String(Math.round((cropState.tempCropX / cropState.maxCropX) * 1000)) : "500";
        }
      } else if (isVertical) {
        cropState.orientation = "vertical";
        cropState.maxCropX = 0;
        cropState.maxCropY = (H - W) / H;
        const defaultY = 0;
        cropState.tempCropX = 0;
        cropState.tempCropY = state.currentSubmission.pixiv?.crop_y != null ? Number(state.currentSubmission.pixiv.crop_y) : defaultY;

        if (elements.cropModalSubtitle) {
          elements.cropModalSubtitle.textContent = `当前为竖图 (${W}×${H})，裁切正方形边长为 ${W}px，可上下拖动或滑动调整`;
        }
        if (elements.cropDragHintText) elements.cropDragHintText.textContent = "🖐️ 鼠标按住上下拖拽平移";
        if (elements.cropSliderStartLabel) elements.cropSliderStartLabel.textContent = "顶端";
        if (elements.cropSliderEndLabel) elements.cropSliderEndLabel.textContent = "底端";
        if (elements.cropPresetStartBtn) elements.cropPresetStartBtn.textContent = "⬆️ 置顶";
        if (elements.cropPresetCenterBtn) elements.cropPresetCenterBtn.textContent = "🎯 居中";
        if (elements.cropPresetEndBtn) elements.cropPresetEndBtn.textContent = "⬇️ 置底";
        if (elements.cropRangeSlider) {
          elements.cropRangeSlider.disabled = false;
          elements.cropRangeSlider.value = cropState.maxCropY > 0 ? String(Math.round((cropState.tempCropY / cropState.maxCropY) * 1000)) : "0";
        }
      } else {
        cropState.orientation = "square";
        cropState.maxCropX = 0;
        cropState.maxCropY = 0;
        cropState.tempCropX = 0;
        cropState.tempCropY = 0;

        if (elements.cropModalSubtitle) {
          elements.cropModalSubtitle.textContent = `当前为正方形图片 (${W}×${H})，默认全图填充，无需额外裁剪`;
        }
        if (elements.cropDragHintText) elements.cropDragHintText.textContent = "正方形图片无需裁剪";
        if (elements.cropRangeSlider) elements.cropRangeSlider.disabled = true;
      }

      if (elements.cropStage) {
        elements.cropStage.className = isHorizontal
          ? "crop-stage horizontal"
          : isVertical
          ? "crop-stage vertical"
          : "crop-stage";
      }

      if (elements.cropStageImg) elements.cropStageImg.src = previewUrl;
      if (elements.cropLivePreviewLg) elements.cropLivePreviewLg.src = previewUrl;
      if (elements.cropLivePreviewSm) elements.cropLivePreviewSm.src = previewUrl;

      renderCropModalTransforms();
      elements.pixivCropDialog.showModal();
    };

    const cachedAsset = state.loadedAssets.get(assetId);
    if (cachedAsset && cachedAsset.width && cachedAsset.height) {
      setupDialog(cachedAsset.width, cachedAsset.height);
    } else {
      const tempImg = new Image();
      tempImg.onload = () => {
        setupDialog(tempImg.naturalWidth, tempImg.naturalHeight);
      };
      tempImg.src = previewUrl;
    }
  }

  function renderCropModalTransforms() {
    const isHorizontal = cropState.orientation === "horizontal";
    const isVertical = cropState.orientation === "vertical";

    const cx = isHorizontal ? Math.max(0, Math.min(cropState.maxCropX, cropState.tempCropX)) : 0;
    const cy = isVertical ? Math.max(0, Math.min(cropState.maxCropY, cropState.tempCropY)) : 0;

    if (elements.cropCoordsText) {
      elements.cropCoordsText.textContent = `crop[x]=${cx.toFixed(6)}, crop[y]=${cy.toFixed(6)}`;
    }

    const stageImg = elements.cropStageImg;
    if (stageImg) {
      if (isHorizontal) {
        stageImg.style.height = "280px";
        stageImg.style.width = "auto";
        stageImg.style.maxWidth = "none";
        stageImg.style.maxHeight = "none";
        stageImg.style.transform = `translateX(-${(cx * 100).toFixed(4)}%)`;
      } else if (isVertical) {
        stageImg.style.width = "280px";
        stageImg.style.height = "auto";
        stageImg.style.maxWidth = "none";
        stageImg.style.maxHeight = "none";
        stageImg.style.transform = `translateY(-${(cy * 100).toFixed(4)}%)`;
      } else {
        stageImg.style.width = "280px";
        stageImg.style.height = "280px";
        stageImg.style.maxWidth = "none";
        stageImg.style.maxHeight = "none";
        stageImg.style.transform = "none";
      }
    }

    [elements.cropLivePreviewLg, elements.cropLivePreviewSm].forEach((previewImg) => {
      if (!previewImg) return;
      if (isHorizontal) {
        previewImg.style.height = "100%";
        previewImg.style.width = "auto";
        previewImg.style.maxWidth = "none";
        previewImg.style.maxHeight = "none";
        previewImg.style.transform = `translateX(-${(cx * 100).toFixed(4)}%)`;
      } else if (isVertical) {
        previewImg.style.width = "100%";
        previewImg.style.height = "auto";
        previewImg.style.maxWidth = "none";
        previewImg.style.maxHeight = "none";
        previewImg.style.transform = `translateY(-${(cy * 100).toFixed(4)}%)`;
      } else {
        previewImg.style.width = "100%";
        previewImg.style.height = "100%";
        previewImg.style.maxWidth = "none";
        previewImg.style.maxHeight = "none";
        previewImg.style.transform = "none";
      }
    });
  }

  function renderSetItems() {
    elements.setItemsContainer.innerHTML = "";
    const activeSet = state.currentSubmission.currentSetTab;
    const assetIds = state.currentSubmission.sets[activeSet] || [];

    if (!assetIds.length) {
      elements.setItemsContainer.innerHTML = '<div class="helper-text" style="padding:16px 10px;text-align:center;">当前集合为空，可从中间素材列表勾选后点击“加入当前集合”</div>';
      return;
    }

    for (let index = 0; index < assetIds.length; index++) {
      const assetId = assetIds[index];
      const asset = state.loadedAssets.get(assetId);
      const displayName = asset ? asset.display_name : assetId;
      const previewUrl = `/api/assets/${encodeURIComponent(assetId)}/preview`;

      // 提取副标题信息（尺寸 + 角色/画风）
      let subMeta = "";
      if (asset) {
        const dims = asset.width && asset.height ? `${asset.width}×${asset.height}` : "";
        const char = asset.values?.character || "";
        const art = asset.values?.artist || "";
        subMeta = [dims, char, art].filter(Boolean).join(" · ") || assetId.slice(0, 16);
      } else {
        subMeta = assetId.length > 24 ? `${assetId.slice(0, 12)}...${assetId.slice(-8)}` : assetId;
      }

      const row = document.createElement("div");
      row.className = "set-item-row";
      row.draggable = true;
      row.dataset.setIndex = String(index);
      row.title = "上下拖拽可调整排序；点击查看大图与生成详情";
      row.innerHTML = `
        <span class="set-item-drag-handle" title="按住上下拖拽调整顺序">⠿</span>
        <span class="set-item-idx">#${index + 1}</span>
        <img class="set-item-thumb" src="${previewUrl}" alt="thumb" loading="lazy">
        <div class="set-item-info">
          <span class="set-item-title" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span>
          <span class="set-item-meta" title="${escapeHtml(subMeta)}">${escapeHtml(subMeta)}</span>
        </div>
      `;

      // 点击整行直接打开大图与详情（在非拖拽状态下）
      let isDragging = false;
      row.addEventListener("click", (e) => {
        if (isDragging) return;
        if (e.target.closest(".set-item-action-btn") || e.target.closest(".set-item-drag-handle")) return;
        openLightbox(assetId, [...assetIds]);
      });

      // 拖拽排序事件
      row.addEventListener("dragstart", (e) => {
        isDragging = true;
        state.draggedSetItemIndex = index;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(index));
        setTimeout(() => row.classList.add("dragging"), 0);
      });

      row.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const rect = row.getBoundingClientRect();
        const isTop = e.clientY - rect.top < rect.height / 2;
        row.classList.toggle("drag-over-top", isTop);
        row.classList.toggle("drag-over-bottom", !isTop);
      });

      row.addEventListener("dragleave", () => {
        row.classList.remove("drag-over-top", "drag-over-bottom");
      });

      row.addEventListener("drop", (e) => {
        e.preventDefault();
        row.classList.remove("drag-over-top", "drag-over-bottom");
        const srcIdx = state.draggedSetItemIndex;
        if (srcIdx === null || srcIdx === undefined || srcIdx === index) return;

        const rect = row.getBoundingClientRect();
        const isTop = e.clientY - rect.top < rect.height / 2;

        const list = state.currentSubmission.sets[activeSet];
        const [movedItem] = list.splice(srcIdx, 1);
        let insertIdx = index;
        if (!isTop) {
          insertIdx = srcIdx < index ? index : index + 1;
        } else {
          insertIdx = srcIdx < index ? index - 1 : index;
        }
        insertIdx = Math.max(0, Math.min(insertIdx, list.length));
        list.splice(insertIdx, 0, movedItem);
        state.draggedSetItemIndex = null;
        syncSubmissionFormUI();
      });

      row.addEventListener("dragend", () => {
        isDragging = false;
        state.draggedSetItemIndex = null;
        document.querySelectorAll(".set-item-row").forEach((r) => {
          r.classList.remove("dragging", "drag-over-top", "drag-over-bottom");
        });
      });

      const actionsWrap = document.createElement("div");
      actionsWrap.className = "set-item-actions";

      if (index > 0) {
        const upBtn = document.createElement("button");
        upBtn.className = "set-item-action-btn";
        upBtn.type = "button";
        upBtn.textContent = "↑";
        upBtn.title = "上移";
        upBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const item = state.currentSubmission.sets[activeSet].splice(index, 1)[0];
          state.currentSubmission.sets[activeSet].splice(index - 1, 0, item);
          syncSubmissionFormUI();
        });
        actionsWrap.appendChild(upBtn);
      }

      if (index < assetIds.length - 1) {
        const downBtn = document.createElement("button");
        downBtn.className = "set-item-action-btn";
        downBtn.type = "button";
        downBtn.textContent = "↓";
        downBtn.title = "下移";
        downBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const item = state.currentSubmission.sets[activeSet].splice(index, 1)[0];
          state.currentSubmission.sets[activeSet].splice(index + 1, 0, item);
          syncSubmissionFormUI();
        });
        actionsWrap.appendChild(downBtn);
      }

      const removeBtn = document.createElement("button");
      removeBtn.className = "set-item-action-btn btn-remove";
      removeBtn.type = "button";
      removeBtn.textContent = "✕";
      removeBtn.title = "从当前集合移除";
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        state.currentSubmission.sets[activeSet].splice(index, 1);
        syncSubmissionFormUI();
      });
      actionsWrap.appendChild(removeBtn);

      row.appendChild(actionsWrap);
      elements.setItemsContainer.appendChild(row);
    }
  }

  async function executeSaveSubmission(customNotice = null) {
    clearNotice();

    const sub = state.currentSubmission;
    const title = elements.submissionTitle ? elements.submissionTitle.value.trim() : (sub.title || "");
    if (!title) {
      showNotice("投稿标题不能为空", "warning");
      return null;
    }
    if (!sub.sets.all.length) {
      showNotice("all 集合不能为空", "warning");
      return null;
    }

    const dateVal = elements.submissionDate ? elements.submissionDate.value : "";
    const timeVal = elements.submissionTime ? elements.submissionTime.value || "20:00" : "20:00";
    let scheduledAt = null;
    if (dateVal) {
      scheduledAt = `${dateVal}T${timeVal}:00+08:00`;
    }

    const payload = {
      title: title,
      source_import_id: sub.source_import_id || state.filters.import_id || null,
      sets: sub.sets,
      pixiv: {
        title: title,
        caption: elements.pixivCaption ? elements.pixivCaption.value.trim() : (sub.pixiv?.caption || ""),
        tags: sub.pixiv?.tags || [],
        suggested_tags: sub.pixiv?.suggested_tags || state.tagSuggestions.pixiv || [],
        r18: elements.pixivR18 ? elements.pixivR18.checked : (sub.pixiv?.r18 !== false),
        allow_tag_edit: elements.pixivAllowTagEdit ? elements.pixivAllowTagEdit.checked : (sub.pixiv?.allow_tag_edit !== false),
        crop_x: sub.pixiv?.crop_x != null ? Number(sub.pixiv.crop_x) : null,
        crop_y: sub.pixiv?.crop_y != null ? Number(sub.pixiv.crop_y) : null,
        illust_id: sub.pixiv?.illust_id || null,
        published_at: sub.pixiv?.published_at || null,
        last_publish_status: sub.pixiv?.last_publish_status || null,
        last_publish_error: sub.pixiv?.last_publish_error || null,
      },
      revision: sub.task_id ? sub.revision : null,
      scheduled_at: scheduledAt,
    };

    let res;
    if (sub.task_id) {
      res = await fetch(`/api/submissions/${encodeURIComponent(sub.task_id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      if (res.status === 409) {
        throw new Error("投稿版本已发生变化（revision 冲突），请刷新后重试。");
      }
      throw new Error(errData.detail?.message || `保存投稿失败 (${res.status})`);
    }

    const savedData = await res.json();
    if (customNotice) {
      showNotice(customNotice, "info");
    } else if (savedData.scheduled_at) {
      showNotice(`投稿保存成功！任务 ID: ${savedData.task_id}，已同步排期至日历 (${dateVal} ${timeVal})`, "info");
    } else {
      showNotice(`投稿保存成功！任务 ID：${savedData.task_id}`, "info");
    }

    // 如果来自旧计划散图转换，保存后关联回月度计划
    if (sub.legacyInlineSource) {
      await associateTaskToMonthlyPlan(savedData.task_id, sub.legacyInlineSource);
      sub.legacyInlineSource = null;
      elements.legacyConvertBanner.classList.add("hidden");
    }

    state.currentSubmission = {
      task_id: savedData.task_id,
      title: savedData.title,
      source_import_id: savedData.source_import_id,
      revision: savedData.revision,
      sets: savedData.sets,
      pixiv: savedData.pixiv ? {
        title: savedData.pixiv.title || savedData.title,
        caption: savedData.pixiv.caption || "",
        tags: Array.isArray(savedData.pixiv.tags) ? [...savedData.pixiv.tags] : [],
        suggested_tags: Array.isArray(savedData.pixiv.suggested_tags) ? [...savedData.pixiv.suggested_tags] : [],
        r18: savedData.pixiv.r18 !== false,
        allow_tag_edit: savedData.pixiv.allow_tag_edit !== false,
        crop_x: savedData.pixiv.crop_x != null ? Number(savedData.pixiv.crop_x) : null,
        crop_y: savedData.pixiv.crop_y != null ? Number(savedData.pixiv.crop_y) : null,
        illust_id: savedData.pixiv.illust_id || null,
        published_at: savedData.pixiv.published_at || null,
        last_publish_status: savedData.pixiv.last_publish_status || null,
        last_publish_error: savedData.pixiv.last_publish_error || null,
      } : payload.pixiv,
      scheduled_at: savedData.scheduled_at || null,
      currentSetTab: sub.currentSetTab,
      legacyInlineSource: null,
    };
    state.tagSuggestions.pixiv = state.currentSubmission.pixiv.suggested_tags || [];

    syncSubmissionFormUI();
    loadHistoricalSubmissions();
    return savedData;
  }

  async function handleSubmissionSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    try {
      await executeSaveSubmission();
    } catch (err) {
      showNotice(err.message, "error");
    }
  }

  async function handleDeleteSubmission() {
    const sub = state.currentSubmission;
    if (!sub || !sub.task_id) return;
    const title = elements.submissionTitle.value.trim() || sub.task_id;
    if (
      !confirm(
        `确定要删除投稿任务【${title}】吗？\n\n删除后将彻底移除该投稿选集与导出产物，并自动清理不再被其他投稿引用的图片的「已投稿」标记。`
      )
    ) {
      return;
    }

    try {
      const res = await fetch(`/api/submissions/${encodeURIComponent(sub.task_id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail?.message || `删除投稿失败 (${res.status})`);
      }
      const data = await res.json();
      showNotice(`已成功删除投稿【${title}】`, "info");

      // 如果当前快照中有被取消标记的素材，更新本地状态
      const unmarkedSet = new Set(data.unmarked_asset_ids || []);
      if (unmarkedSet.size > 0 && state.allAssets) {
        state.allAssets.forEach((item) => {
          if (unmarkedSet.has(item.asset_id)) {
            item.usage = (item.usage || []).filter((u) => u === "favorite");
          }
        });
        applyInstantFilters();
      }

      resetSubmissionEditor();
      await loadHistoricalSubmissions();
    } catch (err) {
      showNotice(err.message, "error");
    }
  }

  async function associateTaskToMonthlyPlan(taskId, legacySource) {
    try {
      const { plan_id, entry_id, plan_revision } = legacySource;
      const planRes = await fetch(`/api/plans/${encodeURIComponent(plan_id)}`);
      if (!planRes.ok) return;
      const plan = await planRes.json();
      const entry = (plan.entries || []).find((e) => e.entry_id === entry_id);
      if (!entry) return;

      const updatePayload = {
        revision: plan_revision || plan.revision,
        entry: {
          entry_id: entry.entry_id,
          scheduled_at: entry.scheduled_at,
          title: entry.title,
          content: { kind: "task", task_id: taskId },
        },
      };

      const putRes = await fetch(
        `/api/plans/${encodeURIComponent(plan_id)}/entries/${encodeURIComponent(entry_id)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updatePayload),
        }
      );
      if (putRes.ok) {
        showNotice(`已将任务 ${taskId} 关联至月计划 ${plan_id}`, "info");
      }
    } catch (err) {
      console.warn("关联月计划失败", err);
    }
  }

  // ================= 导出发布包流程 =================

  function resetExportUI() {
    elements.startExportBtn.disabled = !state.currentSubmission.task_id;
    elements.exportProgressBox.classList.add("hidden");
    elements.exportCompletedBox.classList.add("hidden");
    elements.exportErrorBox.classList.add("hidden");
    state.latestBuildData = null;
    if (state.exportPollTimer) {
      clearInterval(state.exportPollTimer);
      state.exportPollTimer = null;
    }
  }

  async function checkLastExportForTask(taskId) {
    resetExportUI();
    if (!taskId) return;
    try {
      await loadLatestBuildDetails(taskId);
    } catch (err) {
      // 忽略
    }
  }

  async function loadLatestBuildDetails(taskId) {
    if (!taskId) return;
    try {
      const res = await fetch(`/api/submissions/${encodeURIComponent(taskId)}/latest-build`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data.has_build) {
        elements.exportCompletedBox.classList.add("hidden");
        state.latestBuildData = null;
        return;
      }

      state.latestBuildData = data;
      elements.exportCompletedBox.classList.remove("hidden");

      // 1. 导出时间
      if (elements.exportTimeLabel && data.exported_at) {
        const d = new Date(data.exported_at);
        elements.exportTimeLabel.textContent = `构建时间: ${d.toLocaleString("zh-CN")}`;
      }

      // 2. 流水线算子信息
      if (elements.pipelineOpsList) {
        elements.pipelineOpsList.innerHTML = "";
        const ops = data.operations || [];
        for (const op of ops) {
          const item = document.createElement("div");
          item.className = "pipeline-op-item";
          const badgeClass = op.enabled ? "enabled" : "disabled";
          const badgeText = op.enabled ? "已启用" : "未开启";
          item.innerHTML = `
            <span class="pipeline-op-badge ${badgeClass}">${badgeText}</span>
            <div class="pipeline-op-content">
              <span class="pipeline-op-name">${escapeHtml(op.title)}</span>
              <span class="pipeline-op-desc">${escapeHtml(op.description)}</span>
            </div>
          `;
          elements.pipelineOpsList.appendChild(item);
        }

        if (data.mosaic_options) {
          if (elements.exportMosaicToggle) {
            elements.exportMosaicToggle.checked = Boolean(data.mosaic_options.enabled);
            if (elements.exportMosaicParams) {
              if (data.mosaic_options.enabled) {
                elements.exportMosaicParams.classList.remove("hidden");
              } else {
                elements.exportMosaicParams.classList.add("hidden");
              }
            }
          }
          if (elements.exportMosaicPixelSize && data.mosaic_options.pixel_size) {
            const psize = data.mosaic_options.pixel_size;
            elements.exportMosaicPixelSize.value = psize;
            if (elements.exportMosaicPixelVal) {
              elements.exportMosaicPixelVal.textContent = `${psize}px`;
            }
          }
        } else if (elements.exportMosaicToggle) {
          elements.exportMosaicToggle.checked = true;
          if (elements.exportMosaicParams) {
            elements.exportMosaicParams.classList.remove("hidden");
          }
        }
      }

      // 3. Zip 归档下载
      if (elements.exportArchivesContainer) {
        elements.exportArchivesContainer.innerHTML = "";
        const archives = data.archives || [];
        for (const arch of archives) {
          const btn = document.createElement("a");
          btn.className = "archive-download-btn";
          btn.href = arch.download_url;
          btn.download = arch.filename;
          const mb = (arch.size_bytes / (1024 * 1024)).toFixed(2);
          btn.innerHTML = `📦 下载 ${escapeHtml(arch.filename)} (${mb} MB)`;
          elements.exportArchivesContainer.appendChild(btn);
        }
      }

      // 4. 更新 Tab 数量角标
      const images = data.images || { all: [], post: [], cover: [] };
      if (elements.exportTabsContainer) {
        const tabPost = elements.exportTabsContainer.querySelector('[data-export-tab="post"]');
        const tabAll = elements.exportTabsContainer.querySelector('[data-export-tab="all"]');
        const tabCover = elements.exportTabsContainer.querySelector('[data-export-tab="cover"]');
        if (tabPost) tabPost.textContent = `正文 post (${images.post?.length || 0})`;
        if (tabAll) tabAll.textContent = `全集 all (${images.all?.length || 0})`;
        if (tabCover) tabCover.textContent = `封面 cover (${images.cover?.length || 0})`;
      }

      renderExportedThumbsGrid();
    } catch (err) {
      console.warn("加载最新导出详情失败", err);
    }
  }

    function renderExportedThumbsGrid() {
    if (!elements.exportedThumbsGrid || !state.latestBuildData) return;
    elements.exportedThumbsGrid.innerHTML = "";
    const tab = state.currentExportTab || "all";
    const imgList = state.latestBuildData.images?.[tab] || [];

    if (!imgList.length) {
      elements.exportedThumbsGrid.innerHTML = '<div class="helper-text" style="grid-column: 1 / -1; text-align: center; padding: 12px;">该集合下暂无导出图片</div>';
      return;
    }

    for (let i = 0; i < imgList.length; i++) {
      const imgItem = imgList[i];
      const card = document.createElement("div");
      card.className = "exported-thumb-card";
      card.title = `点击查看成品大图: ${imgItem.filename}`;
      const kb = Math.round(imgItem.size_bytes / 1024);
      card.innerHTML = `
        <div class="exported-thumb-img-wrap">
          <span class="exported-thumb-order">#${i + 1}</span>
          <img class="exported-thumb-img" src="${imgItem.preview_url}" alt="${escapeHtml(imgItem.filename)}" loading="lazy">
        </div>
        <div class="exported-thumb-meta">
          <span class="exported-thumb-name">${escapeHtml(imgItem.filename)}</span>
          <span class="helper-text" style="font-size:9px;">${kb} KB</span>
        </div>
      `;

      card.addEventListener("click", () => {
        openExportedLightbox(i, imgList, tab);
      });

      elements.exportedThumbsGrid.appendChild(card);
    }
  }

  // =====================================================================
  // 🎨 自研轻量马赛克画笔编辑器 (替代 Painterro)
  // 参考图贴士 tutieshi.com/mosaic 的多层 Canvas 画笔马赛克交互
  // =====================================================================
  const mosaicEditor = {
    canvas: null,       // 主画布 (绘制结果)
    cursorCanvas: null,  // 光标画布 (hover 光标)
    ctx: null,
    cursorCtx: null,
    wrap: null,          // 容器 div
    originalImg: null,   // 原始图片 Image 对象
    originalData: null,  // 原始图片像素数据 (用于取色, 避免重复像素化导致推色)
    painting: false,     // 是否正在绘制
    undoStack: [],       // 撤销栈 (ImageData 快照)
    redoStack: [],       // 重做栈
    maxUndoSteps: 30,
    loaded: false,
    // 视口变换 (图片可能大于容器，需要缩放居中)
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    imgW: 0,
    imgH: 0,
  };

  /** 初始化马赛克编辑器 DOM 引用 */
  function initMosaicEditor() {
    mosaicEditor.canvas = document.getElementById("mosaic-canvas-main");
    mosaicEditor.cursorCanvas = document.getElementById("mosaic-canvas-cursor");
    mosaicEditor.wrap = document.getElementById("mosaic-canvas-wrap");
    if (!mosaicEditor.canvas || !mosaicEditor.cursorCanvas || !mosaicEditor.wrap) return;
    mosaicEditor.ctx = mosaicEditor.canvas.getContext("2d", { willReadFrequently: true });
    mosaicEditor.cursorCtx = mosaicEditor.cursorCanvas.getContext("2d");

    // 鼠标事件绑定
    mosaicEditor.wrap.addEventListener("mousedown", onMosaicMouseDown);
    mosaicEditor.wrap.addEventListener("mousemove", onMosaicMouseMove);
    mosaicEditor.wrap.addEventListener("mouseup", onMosaicMouseUp);
    mosaicEditor.wrap.addEventListener("mouseleave", onMosaicMouseUp);

    // 工具栏
    const brushSizeSlider = document.getElementById("mosaic-brush-size");
    const blockSizeSlider = document.getElementById("mosaic-block-size");
    if (brushSizeSlider) {
      brushSizeSlider.addEventListener("input", () => {
        document.getElementById("mosaic-brush-size-val").textContent = brushSizeSlider.value;
      });
    }
    if (blockSizeSlider) {
      blockSizeSlider.addEventListener("input", () => {
        document.getElementById("mosaic-block-size-val").textContent = blockSizeSlider.value;
      });
    }

    const undoBtn = document.getElementById("mosaic-undo-btn");
    const redoBtn = document.getElementById("mosaic-redo-btn");
    const saveBtn = document.getElementById("mosaic-save-btn");
    if (undoBtn) undoBtn.addEventListener("click", mosaicUndo);
    if (redoBtn) redoBtn.addEventListener("click", mosaicRedo);
    if (saveBtn) saveBtn.addEventListener("click", mosaicSave);

    // 键盘快捷键
    document.addEventListener("keydown", (e) => {
      if (state.lightbox.mode !== "edit") return;
      if (e.ctrlKey && e.key === "z") { e.preventDefault(); mosaicUndo(); }
      if (e.ctrlKey && e.key === "y") { e.preventDefault(); mosaicRedo(); }
    });
  }

  /** 加载图片到画布 */
  function loadImageToMosaic(url) {
    mosaicEditor.loaded = false;
    mosaicEditor.undoStack = [];
    mosaicEditor.redoStack = [];
    updateUndoRedoButtons();

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      mosaicEditor.originalImg = img;
      mosaicEditor.imgW = img.naturalWidth;
      mosaicEditor.imgH = img.naturalHeight;
      fitCanvasToWrap();
      mosaicEditor.loaded = true;
      // 保存初始快照
      pushUndoSnapshot();
    };
    img.onerror = () => {
      showNotice("加载图片到编辑器失败", "error");
    };
    img.src = url;
  }

  /** 根据容器尺寸计算缩放 & 重绘画布 */
  function fitCanvasToWrap() {
    if (!mosaicEditor.wrap || !mosaicEditor.originalImg) return;
    const wrapRect = mosaicEditor.wrap.getBoundingClientRect();
    const wW = wrapRect.width;
    const wH = wrapRect.height;
    const iW = mosaicEditor.imgW;
    const iH = mosaicEditor.imgH;

    // 画布尺寸 = 原始图片尺寸 (1:1 像素操作, 不损失精度)
    mosaicEditor.canvas.width = iW;
    mosaicEditor.canvas.height = iH;
    mosaicEditor.cursorCanvas.width = iW;
    mosaicEditor.cursorCanvas.height = iH;

    // CSS 缩放以适配容器
    const scale = Math.min(wW / iW, wH / iH, 1); // 不超过原图
    mosaicEditor.scale = scale;
    const displayW = Math.round(iW * scale);
    const displayH = Math.round(iH * scale);
    mosaicEditor.offsetX = Math.round((wW - displayW) / 2);
    mosaicEditor.offsetY = Math.round((wH - displayH) / 2);

    // 设置 CSS 尺寸 & 位置
    [mosaicEditor.canvas, mosaicEditor.cursorCanvas].forEach(c => {
      c.style.width = displayW + "px";
      c.style.height = displayH + "px";
      c.style.left = mosaicEditor.offsetX + "px";
      c.style.top = mosaicEditor.offsetY + "px";
    });

    // 绘制原图到主画布 & 缓存原始像素数据
    mosaicEditor.ctx.drawImage(mosaicEditor.originalImg, 0, 0, iW, iH);
    mosaicEditor.originalData = mosaicEditor.ctx.getImageData(0, 0, iW, iH);
  }

  /** 鼠标坐标 → 画布像素坐标 */
  function wrapMouseToCanvas(e) {
    const rect = mosaicEditor.wrap.getBoundingClientRect();
    const mx = e.clientX - rect.left - mosaicEditor.offsetX;
    const my = e.clientY - rect.top - mosaicEditor.offsetY;
    return {
      x: Math.round(mx / mosaicEditor.scale),
      y: Math.round(my / mosaicEditor.scale),
    };
  }

  /** 在画布指定位置执行马赛克打码 (核心算法) */
  function applyMosaicAt(cx, cy) {
    const ctx = mosaicEditor.ctx;
    const origData = mosaicEditor.originalData;
    if (!origData) return;
    const brushR = parseInt(document.getElementById("mosaic-brush-size").value, 10) || 28;
    const blockSize = parseInt(document.getElementById("mosaic-block-size").value, 10) || 12;
    const iW = mosaicEditor.imgW;
    const iH = mosaicEditor.imgH;
    const origPx = origData.data;

    // 画笔半径 (画布像素空间)
    const r = Math.round(brushR / mosaicEditor.scale);

    // 计算受影响的矩形区域
    const x0 = Math.max(0, cx - r);
    const y0 = Math.max(0, cy - r);
    const x1 = Math.min(iW, cx + r);
    const y1 = Math.min(iH, cy + r);
    if (x1 <= x0 || y1 <= y0) return;

    // 获取当前画布该区域用于写入
    const regionW = x1 - x0;
    const regionH = y1 - y0;
    const imgData = ctx.getImageData(x0, y0, regionW, regionH);
    const data = imgData.data;

    // 🔑 关键：对齐到全局网格 (基于图片 (0,0) 的 blockSize 倍数)
    // 这样无论画笔从哪里开始涂，同一个格子始终一致
    const gridX0 = Math.floor(x0 / blockSize) * blockSize;
    const gridY0 = Math.floor(y0 / blockSize) * blockSize;
    const gridX1 = Math.ceil(x1 / blockSize) * blockSize;
    const gridY1 = Math.ceil(y1 / blockSize) * blockSize;

    for (let gy = gridY0; gy < gridY1; gy += blockSize) {
      for (let gx = gridX0; gx < gridX1; gx += blockSize) {
        // 块在图片中的实际范围 (裁剪到图片边界)
        const bx0 = Math.max(gx, 0);
        const by0 = Math.max(gy, 0);
        const bx1 = Math.min(gx + blockSize, iW);
        const by1 = Math.min(gy + blockSize, iH);
        if (bx1 <= bx0 || by1 <= by0) continue;

        // 检查块中心是否在画笔圆内
        const bcx = (bx0 + bx1) / 2;
        const bcy = (by0 + by1) / 2;
        const dx = bcx - cx;
        const dy = bcy - cy;
        if (dx * dx + dy * dy > r * r) continue;

        // 从【原始图片】计算块内平均色
        let sumR = 0, sumG = 0, sumB = 0, count = 0;
        for (let py = by0; py < by1; py++) {
          for (let px = bx0; px < bx1; px++) {
            const origIdx = (py * iW + px) * 4;
            sumR += origPx[origIdx];
            sumG += origPx[origIdx + 1];
            sumB += origPx[origIdx + 2];
            count++;
          }
        }
        const avgR = Math.round(sumR / count);
        const avgG = Math.round(sumG / count);
        const avgB = Math.round(sumB / count);

        // 用平均色填充到当前画布 (转换为区域局部坐标)
        for (let py = by0; py < by1; py++) {
          for (let px = bx0; px < bx1; px++) {
            const localX = px - x0;
            const localY = py - y0;
            if (localX < 0 || localX >= regionW || localY < 0 || localY >= regionH) continue;
            const idx = (localY * regionW + localX) * 4;
            data[idx] = avgR;
            data[idx + 1] = avgG;
            data[idx + 2] = avgB;
          }
        }
      }
    }

    ctx.putImageData(imgData, x0, y0);
  }

  /** 绘制画笔光标 */
  function drawMosaicCursor(cx, cy) {
    const cCtx = mosaicEditor.cursorCtx;
    const iW = mosaicEditor.imgW;
    const iH = mosaicEditor.imgH;
    cCtx.clearRect(0, 0, iW, iH);

    const brushR = parseInt(document.getElementById("mosaic-brush-size").value, 10) || 28;
    const r = Math.round(brushR / mosaicEditor.scale);

    cCtx.beginPath();
    cCtx.arc(cx, cy, r, 0, Math.PI * 2);
    cCtx.strokeStyle = "rgba(88,166,255,0.8)";
    cCtx.lineWidth = Math.max(1, 2 / mosaicEditor.scale);
    cCtx.stroke();
    // 半透明填充预览
    cCtx.fillStyle = "rgba(88,166,255,0.08)";
    cCtx.fill();
  }

  function onMosaicMouseDown(e) {
    if (e.button !== 0 || !mosaicEditor.loaded) return;
    mosaicEditor.painting = true;
    const { x, y } = wrapMouseToCanvas(e);
    applyMosaicAt(x, y);
  }

  function onMosaicMouseMove(e) {
    if (!mosaicEditor.loaded) return;
    const { x, y } = wrapMouseToCanvas(e);
    drawMosaicCursor(x, y);
    if (mosaicEditor.painting) {
      applyMosaicAt(x, y);
    }
  }

  function onMosaicMouseUp(e) {
    if (mosaicEditor.painting) {
      mosaicEditor.painting = false;
      // 松开鼠标后保存一个撤销快照
      pushUndoSnapshot();
    }
  }

  /** 保存快照到撤销栈 */
  function pushUndoSnapshot() {
    if (!mosaicEditor.ctx || !mosaicEditor.loaded) return;
    const snap = mosaicEditor.ctx.getImageData(0, 0, mosaicEditor.imgW, mosaicEditor.imgH);
    mosaicEditor.undoStack.push(snap);
    if (mosaicEditor.undoStack.length > mosaicEditor.maxUndoSteps) {
      mosaicEditor.undoStack.shift();
    }
    mosaicEditor.redoStack = [];
    updateUndoRedoButtons();
  }

  function mosaicUndo() {
    if (mosaicEditor.undoStack.length <= 1) return; // 栈底是初始状态
    const current = mosaicEditor.undoStack.pop();
    mosaicEditor.redoStack.push(current);
    const prev = mosaicEditor.undoStack[mosaicEditor.undoStack.length - 1];
    mosaicEditor.ctx.putImageData(prev, 0, 0);
    updateUndoRedoButtons();
  }

  function mosaicRedo() {
    if (mosaicEditor.redoStack.length === 0) return;
    const snap = mosaicEditor.redoStack.pop();
    mosaicEditor.undoStack.push(snap);
    mosaicEditor.ctx.putImageData(snap, 0, 0);
    updateUndoRedoButtons();
  }

  function updateUndoRedoButtons() {
    const undoBtn = document.getElementById("mosaic-undo-btn");
    const redoBtn = document.getElementById("mosaic-redo-btn");
    if (undoBtn) undoBtn.disabled = mosaicEditor.undoStack.length <= 1;
    if (redoBtn) redoBtn.disabled = mosaicEditor.redoStack.length === 0;
  }

  /** 保存编辑结果到后端 */
  async function mosaicSave() {
    const item = state.lightbox.exportItem;
    if (!item || !mosaicEditor.loaded) return;

    try {
      showNotice("正在保存手动打码修改...", "info");

      // 导出 canvas 为 PNG blob
      const blob = await new Promise(resolve => mosaicEditor.canvas.toBlob(resolve, "image/png"));
      const taskId = state.currentSubmission.task_id;
      const tabName = state.lightbox.exportTabName;
      const filename = item.filename;

      const res = await fetch(`/api/submissions/${encodeURIComponent(taskId)}/build-images/${encodeURIComponent(tabName)}/${encodeURIComponent(filename)}`, {
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body: blob,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `保存失败 (${res.status})`);
      }

      showNotice("✅ 手动打码已成功保存到发布包！", "success");

      // 刷新大图与各集合面板缩略图缓存
      const nowTs = Date.now();
      const cacheBustUrl = `${item.preview_url.split("?")[0]}?t=${nowTs}`;
      item.preview_url = cacheBustUrl;
      elements.previewImage.src = cacheBustUrl;

      if (state.latestBuildData && state.latestBuildData.images) {
        for (const tab of ["all", "post", "cover"]) {
          const list = state.latestBuildData.images[tab] || [];
          for (const img of list) {
            if (img.filename === filename) {
              img.preview_url = `${img.preview_url.split("?")[0]}?t=${nowTs}`;
              img.size_bytes = blob.size;
            }
          }
        }
      }

      renderExportedThumbsGrid();

      // 自动切回 view 模式
      switchLightboxMode("view");
    } catch (err) {
      showNotice(`保存编辑失败：${err.message}`, "error");
    }
  }

  // =====================================================================
  // ✨ AI 局部重绘 (Inpaint) 编辑器与 Split Slider 对比组件
  // =====================================================================
  const inpaintEditor = {
    currentAssetId: null,
    canvasBg: null,
    canvasMask: null,
    canvasCursor: null,
    wrap: null,
    ctxBg: null,
    ctxMask: null,
    cursorCtx: null,
    originalImg: null,
    painting: false,
    undoStack: [],
    redoStack: [],
    maxUndoSteps: 30,
    loaded: false,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    imgW: 0,
    imgH: 0,

    batches: [], // 多轮批次列表 [{ batchId, roundNumber, sessionId, strength, prompt, timestamp, collapsed, candidates: [...] }]
    activeCandidate: null, // 当前选中的候选图对象
    viewMode: "mask", // 当前左侧展示模式："mask" (涂抹画布) | "compare" (对比滑块)
    count: 2,
    strength: 0.70,
    sliderPos: 50,
    isDraggingSlider: false,
  };

  /** 切换左侧视图模式：mask (涂抹遮罩) ↔ compare (效果对比) */
  function setInpaintViewMode(mode) {
    inpaintEditor.viewMode = mode;

    if (elements.inpaintTabMask) elements.inpaintTabMask.classList.toggle("active", mode === "mask");
    if (elements.inpaintTabCompare) elements.inpaintTabCompare.classList.toggle("active", mode === "compare");

    if (mode === "mask") {
      if (elements.inpaintCompareWrap) elements.inpaintCompareWrap.classList.add("hidden");
      if (elements.inpaintCanvasWrap) elements.inpaintCanvasWrap.classList.remove("hidden");
      if (elements.inpaintMaskTools) elements.inpaintMaskTools.classList.remove("hidden");
      if (elements.inpaintCompareTools) elements.inpaintCompareTools.classList.add("hidden");
      requestAnimationFrame(() => {
        fitInpaintCanvasToWrap();
      });
    } else if (mode === "compare") {
      if (elements.inpaintCanvasWrap) elements.inpaintCanvasWrap.classList.add("hidden");
      if (elements.inpaintCompareWrap) elements.inpaintCompareWrap.classList.remove("hidden");
      if (elements.inpaintMaskTools) elements.inpaintMaskTools.classList.add("hidden");
      if (elements.inpaintCompareTools) elements.inpaintCompareTools.classList.remove("hidden");
      if (elements.inpaintTabCompare) elements.inpaintTabCompare.classList.remove("hidden");
      requestAnimationFrame(() => {
        fitInpaintCompareToWrap();
      });
    }
  }

  /** 初始化 Inpaint 编辑器 DOM 与事件绑定 */
  function initInpaintEditor() {
    inpaintEditor.canvasBg = elements.inpaintCanvasBg;
    inpaintEditor.canvasMask = elements.inpaintCanvasMask;
    inpaintEditor.canvasCursor = elements.inpaintCanvasCursor;
    inpaintEditor.wrap = elements.inpaintCanvasWrap;

    if (!inpaintEditor.canvasBg || !inpaintEditor.canvasMask || !inpaintEditor.canvasCursor || !inpaintEditor.wrap) return;

    inpaintEditor.ctxBg = inpaintEditor.canvasBg.getContext("2d");
    inpaintEditor.ctxMask = inpaintEditor.canvasMask.getContext("2d", { willReadFrequently: true });
    inpaintEditor.cursorCtx = inpaintEditor.canvasCursor.getContext("2d");

    // 鼠标画布绘制事件
    inpaintEditor.wrap.addEventListener("mousedown", onInpaintMouseDown);
    inpaintEditor.wrap.addEventListener("mousemove", onInpaintMouseMove);
    inpaintEditor.wrap.addEventListener("mouseup", onInpaintMouseUp);
    inpaintEditor.wrap.addEventListener("mouseleave", onInpaintMouseUp);

    // 遮罩画笔粗细
    if (elements.inpaintBrushSize) {
      elements.inpaintBrushSize.addEventListener("input", () => {
        if (elements.inpaintBrushSizeVal) {
          elements.inpaintBrushSizeVal.textContent = elements.inpaintBrushSize.value;
        }
      });
    }

    // 重绘强度
    if (elements.inpaintStrengthSlider) {
      elements.inpaintStrengthSlider.addEventListener("input", () => {
        const val = parseFloat(elements.inpaintStrengthSlider.value) || 0.70;
        inpaintEditor.strength = val;
        if (elements.inpaintStrengthVal) {
          elements.inpaintStrengthVal.textContent = val.toFixed(2);
        }
      });
    }

    // 生成张数单选组
    if (elements.inpaintCountGroup) {
      elements.inpaintCountGroup.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-count]");
        if (!btn) return;
        elements.inpaintCountGroup.querySelectorAll("[data-count]").forEach((b) => b.classList.toggle("active", b === btn));
        inpaintEditor.count = parseInt(btn.dataset.count, 10) || 2;
      });
    }

    // 工具栏操作
    if (elements.inpaintUndoBtn) elements.inpaintUndoBtn.addEventListener("click", inpaintUndo);
    if (elements.inpaintRedoBtn) elements.inpaintRedoBtn.addEventListener("click", inpaintRedo);
    if (elements.inpaintClearBtn) elements.inpaintClearBtn.addEventListener("click", inpaintClearMask);

    // 视图模式切换（调整遮罩 ↔ 效果对比）
    if (elements.inpaintViewModeTabs) {
      elements.inpaintViewModeTabs.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-inpaint-mode]");
        if (!btn) return;
        setInpaintViewMode(btn.dataset.inpaintMode);
      });
    }

    // 对比模式下的快捷操作按钮
    if (elements.inpaintSwitchToMaskBtn) {
      elements.inpaintSwitchToMaskBtn.addEventListener("click", () => {
        setInpaintViewMode("mask");
      });
    }
    if (elements.inpaintResetSliderBtn) {
      elements.inpaintResetSliderBtn.addEventListener("click", () => {
        updateSplitSlider(50);
      });
    }

    // 核心按钮
    if (elements.inpaintGenerateBtn) elements.inpaintGenerateBtn.addEventListener("click", handleInpaintGenerate);
    if (elements.inpaintApplyBtn) elements.inpaintApplyBtn.addEventListener("click", handleInpaintApply);
    if (elements.inpaintDiscardBtn) elements.inpaintDiscardBtn.addEventListener("click", handleInpaintDiscard);

    // 按住查看原图
    if (elements.inpaintToggleDiffBtn) {
      const showOriginal = () => {
        if (elements.inpaintCompareAfterWrap) elements.inpaintCompareAfterWrap.style.display = "none";
      };
      const showComparison = () => {
        if (elements.inpaintCompareAfterWrap) elements.inpaintCompareAfterWrap.style.display = "";
      };
      elements.inpaintToggleDiffBtn.addEventListener("mousedown", showOriginal);
      elements.inpaintToggleDiffBtn.addEventListener("touchstart", showOriginal, { passive: true });
      elements.inpaintToggleDiffBtn.addEventListener("mouseup", showComparison);
      elements.inpaintToggleDiffBtn.addEventListener("mouseleave", showComparison);
      elements.inpaintToggleDiffBtn.addEventListener("touchend", showComparison, { passive: true });
    }

    // Split Slider 分屏对比滑动条交互
    initSplitSlider();

    // 键盘快捷键
    document.addEventListener("keydown", (e) => {
      if (state.lightbox.mode !== "inpaint") return;
      if (e.ctrlKey && e.key === "z") { e.preventDefault(); inpaintUndo(); }
      if (e.ctrlKey && e.key === "y") { e.preventDefault(); inpaintRedo(); }
    });

    // 窗口尺寸变化自适应
    window.addEventListener("resize", () => {
      if (state.lightbox.mode === "inpaint") {
        if (inpaintEditor.viewMode === "mask") {
          fitInpaintCanvasToWrap();
        } else {
          fitInpaintCompareToWrap();
        }
      }
    });
  }

  /** 加载指定资产到 Inpaint 画布 */
  function loadAssetToInpaint(assetId, forceReload = false) {
    if (!forceReload && inpaintEditor.currentAssetId === assetId && inpaintEditor.loaded) {
      // 相同素材切回重绘 Tab 时，完整保留已有 Mask、候选批次流、提示词输入，仅自适应重绘尺寸
      requestAnimationFrame(() => {
        if (inpaintEditor.viewMode === "mask") {
          fitInpaintCanvasToWrap();
        } else {
          fitInpaintCompareToWrap();
        }
      });
      return;
    }

    inpaintEditor.currentAssetId = assetId;
    inpaintEditor.loaded = false;
    inpaintEditor.undoStack = [];
    inpaintEditor.redoStack = [];
    inpaintEditor.batches = [];
    inpaintEditor.activeCandidate = null;
    updateInpaintUndoRedoButtons();

    // 重置并默认进入 mask 遮罩编辑模式
    setInpaintViewMode("mask");
    if (elements.inpaintTabCompare) elements.inpaintTabCompare.classList.add("hidden");

    // 重置结果区
    if (elements.inpaintResultsSection) elements.inpaintResultsSection.classList.add("hidden");
    if (elements.inpaintStickyFooter) elements.inpaintStickyFooter.classList.add("hidden");
    if (elements.inpaintProgressBox) elements.inpaintProgressBox.classList.add("hidden");

    // 自动预填原图 Prompt 与 Negative Prompt
    const detail = state.lightbox.currentAssetDetails || {};
    const gen = detail.generation_info || {};
    if (elements.inpaintPromptInput) {
      elements.inpaintPromptInput.value = gen.prompt || detail.prompt || "";
    }
    if (elements.inpaintNegPromptInput) {
      elements.inpaintNegPromptInput.value = gen.negative_prompt || detail.negative_prompt || "";
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      inpaintEditor.originalImg = img;
      inpaintEditor.imgW = img.naturalWidth;
      inpaintEditor.imgH = img.naturalHeight;
      fitInpaintCanvasToWrap();
      inpaintEditor.loaded = true;
      pushInpaintUndoSnapshot();
    };
    img.onerror = () => {
      showNotice("加载原图到局部重绘编辑器失败", "error");
    };
    img.src = `/api/assets/${encodeURIComponent(assetId)}/preview?v=${Date.now()}`;
  }

  /** 获取当前局部重绘视口的实际可用物理宽高 */
  function getInpaintViewportDimensions() {
    let wrap = null;
    if (elements.inpaintCompareWrap && !elements.inpaintCompareWrap.classList.contains("hidden")) {
      wrap = elements.inpaintCompareWrap;
    } else if (elements.inpaintCanvasWrap && !elements.inpaintCanvasWrap.classList.contains("hidden")) {
      wrap = elements.inpaintCanvasWrap;
    }

    if (wrap) {
      const r = wrap.getBoundingClientRect();
      if (r.width > 50 && r.height > 50) {
        return { wW: r.width, wH: r.height };
      }
    }

    const area = document.getElementById("lightbox-inpaint-area");
    if (area) {
      const ar = area.getBoundingClientRect();
      if (ar.width > 50 && ar.height > 50) {
        return { wW: ar.width, wH: Math.max(100, ar.height - 48) };
      }
    }

    return {
      wW: Math.max(300, (window.innerWidth - 380)),
      wH: Math.max(300, (window.innerHeight - 120)),
    };
  }

  /** 自适应画板尺寸与 1:1 坐标对齐并最大化撑满视口 */
  function fitInpaintCanvasToWrap() {
    if (!inpaintEditor.originalImg || !inpaintEditor.imgW) return;
    const { wW, wH } = getInpaintViewportDimensions();
    const iW = inpaintEditor.imgW;
    const iH = inpaintEditor.imgH;

    // 保留 20px 视口舒适边距，使图片最大化撑满工作区
    const availW = Math.max(100, wW - 24);
    const availH = Math.max(100, wH - 24);
    const scale = Math.min(availW / iW, availH / iH);

    inpaintEditor.scale = scale;
    const displayW = Math.round(iW * scale);
    const displayH = Math.round(iH * scale);
    const offsetX = Math.round((wW - displayW) / 2);
    const offsetY = Math.round((wH - displayH) / 2);
    inpaintEditor.offsetX = offsetX;
    inpaintEditor.offsetY = offsetY;

    [inpaintEditor.canvasBg, inpaintEditor.canvasMask, inpaintEditor.canvasCursor].forEach((c) => {
      if (!c) return;
      c.width = iW;
      c.height = iH;
      c.style.width = displayW + "px";
      c.style.height = displayH + "px";
      c.style.left = offsetX + "px";
      c.style.top = offsetY + "px";
    });

    // 绘制原图到背景画布
    if (inpaintEditor.ctxBg) {
      inpaintEditor.ctxBg.drawImage(inpaintEditor.originalImg, 0, 0, iW, iH);
    }

    fitInpaintCompareToWrap();
  }

  /** 自适应对比视口尺寸，与画板保持 100% 绝对像素级对齐并撑满可用视口 */
  function fitInpaintCompareToWrap() {
    if (!elements.inpaintCompareInner || !inpaintEditor.imgW) return;
    const { wW, wH } = getInpaintViewportDimensions();
    const iW = inpaintEditor.imgW;
    const iH = inpaintEditor.imgH;

    const availW = Math.max(100, wW - 24);
    const availH = Math.max(100, wH - 24);
    const scale = Math.min(availW / iW, availH / iH);

    const displayW = Math.round(iW * scale);
    const displayH = Math.round(iH * scale);
    const offsetX = Math.round((wW - displayW) / 2);
    const offsetY = Math.round((wH - displayH) / 2);

    const inner = elements.inpaintCompareInner;
    inner.style.width = displayW + "px";
    inner.style.height = displayH + "px";
    inner.style.left = offsetX + "px";
    inner.style.top = offsetY + "px";
  }

  function wrapMouseToInpaintCanvas(e) {
    const wrap = elements.inpaintCanvasWrap || inpaintEditor.wrap;
    const rect = wrap ? wrap.getBoundingClientRect() : { left: 0, top: 0 };
    const mx = e.clientX - rect.left - inpaintEditor.offsetX;
    const my = e.clientY - rect.top - inpaintEditor.offsetY;
    return {
      x: Math.round(mx / inpaintEditor.scale),
      y: Math.round(my / inpaintEditor.scale),
    };
  }

  function applyInpaintBrushAt(x, y) {
    if (!inpaintEditor.loaded || !inpaintEditor.ctxMask) return;
    const ctx = inpaintEditor.ctxMask;
    const brushSize = parseInt(elements.inpaintBrushSize?.value || 36, 10);
    const r = Math.round(brushSize / inpaintEditor.scale);

    ctx.save();
    ctx.fillStyle = "rgba(236, 72, 153, 0.65)"; // 半透明亮品红色遮罩
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawInpaintCursor(cx, cy) {
    const cCtx = inpaintEditor.cursorCtx;
    if (!cCtx) return;
    cCtx.clearRect(0, 0, inpaintEditor.imgW, inpaintEditor.imgH);

    const brushSize = parseInt(elements.inpaintBrushSize?.value || 36, 10);
    const r = Math.round(brushSize / inpaintEditor.scale);

    cCtx.beginPath();
    cCtx.arc(cx, cy, r, 0, Math.PI * 2);
    cCtx.strokeStyle = "rgba(236, 72, 153, 0.9)";
    cCtx.lineWidth = Math.max(1, 2 / inpaintEditor.scale);
    cCtx.stroke();
    cCtx.fillStyle = "rgba(236, 72, 153, 0.15)";
    cCtx.fill();
  }

  function onInpaintMouseDown(e) {
    if (e.button !== 0 || !inpaintEditor.loaded) return;
    inpaintEditor.painting = true;
    const { x, y } = wrapMouseToInpaintCanvas(e);
    applyInpaintBrushAt(x, y);
  }

  function onInpaintMouseMove(e) {
    if (!inpaintEditor.loaded) return;
    const { x, y } = wrapMouseToInpaintCanvas(e);
    drawInpaintCursor(x, y);
    if (inpaintEditor.painting) {
      applyInpaintBrushAt(x, y);
    }
  }

  function onInpaintMouseUp() {
    if (inpaintEditor.painting) {
      inpaintEditor.painting = false;
      pushInpaintUndoSnapshot();
    }
  }

  function pushInpaintUndoSnapshot() {
    if (!inpaintEditor.ctxMask || !inpaintEditor.loaded) return;
    const snap = inpaintEditor.ctxMask.getImageData(0, 0, inpaintEditor.imgW, inpaintEditor.imgH);
    inpaintEditor.undoStack.push(snap);
    if (inpaintEditor.undoStack.length > inpaintEditor.maxUndoSteps) {
      inpaintEditor.undoStack.shift();
    }
    inpaintEditor.redoStack = [];
    updateInpaintUndoRedoButtons();
  }

  function inpaintUndo() {
    if (inpaintEditor.undoStack.length <= 1) return;
    const current = inpaintEditor.undoStack.pop();
    inpaintEditor.redoStack.push(current);
    const prev = inpaintEditor.undoStack[inpaintEditor.undoStack.length - 1];
    inpaintEditor.ctxMask.putImageData(prev, 0, 0);
    updateInpaintUndoRedoButtons();
  }

  function inpaintRedo() {
    if (inpaintEditor.redoStack.length === 0) return;
    const snap = inpaintEditor.redoStack.pop();
    inpaintEditor.undoStack.push(snap);
    inpaintEditor.ctxMask.putImageData(snap, 0, 0);
    updateInpaintUndoRedoButtons();
  }

  function inpaintClearMask() {
    if (!inpaintEditor.ctxMask || !inpaintEditor.loaded) return;
    inpaintEditor.ctxMask.clearRect(0, 0, inpaintEditor.imgW, inpaintEditor.imgH);
    pushInpaintUndoSnapshot();
  }

  function updateInpaintUndoRedoButtons() {
    if (elements.inpaintUndoBtn) elements.inpaintUndoBtn.disabled = inpaintEditor.undoStack.length <= 1;
    if (elements.inpaintRedoBtn) elements.inpaintRedoBtn.disabled = inpaintEditor.redoStack.length === 0;
  }

  /** 发起 AI 局部重绘任务 */
  async function handleInpaintGenerate() {
    const assetId = state.lightbox.activeAssetId;
    if (!assetId || !inpaintEditor.loaded) return;

    // 1. 从遮罩画布提取二值化 Mask
    const iW = inpaintEditor.imgW;
    const iH = inpaintEditor.imgH;
    const maskData = inpaintEditor.ctxMask.getImageData(0, 0, iW, iH);
    const pixels = maskData.data;

    let hasMaskPixels = false;
    const offCanvas = document.createElement("canvas");
    offCanvas.width = iW;
    offCanvas.height = iH;
    const offCtx = offCanvas.getContext("2d");
    const binaryData = offCtx.createImageData(iW, iH);
    const outPx = binaryData.data;

    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] > 10) {
        hasMaskPixels = true;
        outPx[i] = 255;
        outPx[i + 1] = 255;
        outPx[i + 2] = 255;
        outPx[i + 3] = 255;
      } else {
        outPx[i] = 0;
        outPx[i + 1] = 0;
        outPx[i + 2] = 0;
        outPx[i + 3] = 255;
      }
    }

    if (!hasMaskPixels) {
      showNotice("请先用画笔在左侧画布上涂抹要重绘的区域", "warning");
      return;
    }

    offCtx.putImageData(binaryData, 0, 0);
    const maskBase64 = offCanvas.toDataURL("image/png");

    const prompt = elements.inpaintPromptInput?.value || "";
    const negativePrompt = elements.inpaintNegPromptInput?.value || "";
    const strength = inpaintEditor.strength || 0.70;
    const count = inpaintEditor.count || 2;

    let progressTimer = null;
    let currentProgress = 5;

    try {
      // 设置按钮 loading 状态
      if (elements.inpaintGenerateBtn) elements.inpaintGenerateBtn.disabled = true;
      if (elements.inpaintSpinner) elements.inpaintSpinner.classList.remove("hidden");
      if (elements.inpaintGenerateBtnText) elements.inpaintGenerateBtnText.textContent = `🚀 正在重绘 (${count}张顺序生成)...`;

      // 启动动态进度展示
      if (elements.inpaintProgressBox) elements.inpaintProgressBox.classList.remove("hidden");
      if (elements.inpaintProgressFill) elements.inpaintProgressFill.style.width = "5%";
      if (elements.inpaintProgressText) {
        elements.inpaintProgressText.textContent = count === 1 ? "正在重绘候选图..." : `正在生成第 1 / ${count} 张...`;
      }
      if (elements.inpaintProgressHint) {
        elements.inpaintProgressHint.textContent = "单张按序生成中，若遇 429 限流将自动智能重试";
      }

      const estSeconds = count * 5.0;
      const intervalMs = 200;
      const step = (88 / (estSeconds * 1000)) * intervalMs;
      progressTimer = setInterval(() => {
        currentProgress = Math.min(92, currentProgress + step);
        if (elements.inpaintProgressFill) {
          elements.inpaintProgressFill.style.width = `${currentProgress.toFixed(1)}%`;
        }
        if (count > 1 && elements.inpaintProgressText) {
          const approxIndex = Math.min(count, Math.floor((currentProgress / 90) * count) + 1);
          elements.inpaintProgressText.textContent = `正在生成第 ${approxIndex} / ${count} 张...`;
        }
      }, intervalMs);

      showNotice(`正在调用 NovelAI 顺序生成 ${count} 张候选图...`, "info");

      const res = await fetch(`/api/assets/${encodeURIComponent(assetId)}/inpaint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mask_base64: maskBase64,
          prompt: prompt,
          negative_prompt: negativePrompt,
          strength: strength,
          count: count,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `重绘失败 (${res.status})`);
      }

      const result = await res.json();
      const rawCandidates = result.candidates || [];

      // 构造新一轮批次数据
      const roundNum = inpaintEditor.batches.length + 1;
      const batchId = `batch_${Date.now()}_${roundNum}`;
      const newBatch = {
        batchId: batchId,
        roundNumber: roundNum,
        sessionId: result.session_id,
        strength: strength,
        prompt: prompt,
        negativePrompt: negativePrompt,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        collapsed: false,
        candidates: rawCandidates.map((c, idx) => ({
          ...c,
          batchId: batchId,
          sessionId: result.session_id,
          roundNumber: roundNum,
          indexInRound: idx + 1,
          starred: false,
          deleted: false,
        })),
      };

      // 自动收起以往历史各轮
      inpaintEditor.batches.forEach((b) => { b.collapsed = true; });
      // 将最新一轮插入最前
      inpaintEditor.batches.unshift(newBatch);

      // 进度条满格并提示成功
      if (progressTimer) clearInterval(progressTimer);
      if (elements.inpaintProgressFill) elements.inpaintProgressFill.style.width = "100%";
      if (elements.inpaintProgressText) elements.inpaintProgressText.textContent = `✅ 全部 ${rawCandidates.length} 张候选图生成完毕！`;

      showNotice(`✅ 成功生成第 ${roundNum} 轮 (${rawCandidates.length} 张)！请在右侧选择并滑动对比`, "success");

      // 延迟收起进度条并展示候选结果
      setTimeout(() => {
        if (elements.inpaintProgressBox) elements.inpaintProgressBox.classList.add("hidden");
      }, 1200);

      // 渲染候选列表并开启 Split Slider 对比模式
      renderInpaintCandidates();
      if (newBatch.candidates.length > 0) {
        setupInpaintCompareView(newBatch.candidates[0]);
      }
    } catch (err) {
      if (progressTimer) clearInterval(progressTimer);
      if (elements.inpaintProgressText) elements.inpaintProgressText.textContent = `❌ 生成遇到异常：${err.message}`;
      showNotice(`局部重绘失败：${err.message}`, "error");
    } finally {
      if (elements.inpaintGenerateBtn) elements.inpaintGenerateBtn.disabled = false;
      if (elements.inpaintSpinner) elements.inpaintSpinner.classList.add("hidden");
      if (elements.inpaintGenerateBtnText) elements.inpaintGenerateBtnText.textContent = "🚀 重新局部重绘";
    }
  }

  /** 渲染生成的候选图片列表（支持多轮折叠流与标记剔除） */
  function renderInpaintCandidates() {
    if (!elements.inpaintBatchesContainer || !elements.inpaintResultsSection) return;

    let totalActiveCandidates = 0;
    inpaintEditor.batches.forEach((b) => {
      totalActiveCandidates += b.candidates.filter((c) => !c.deleted).length;
    });

    if (totalActiveCandidates === 0) {
      elements.inpaintResultsSection.classList.add("hidden");
      if (elements.inpaintStickyFooter) elements.inpaintStickyFooter.classList.add("hidden");
      return;
    }

    elements.inpaintResultsSection.classList.remove("hidden");
    if (elements.inpaintStickyFooter) elements.inpaintStickyFooter.classList.remove("hidden");

    if (elements.inpaintCandidatesCount) {
      elements.inpaintCandidatesCount.textContent = totalActiveCandidates;
    }
    if (elements.inpaintBatchCountBadge) {
      elements.inpaintBatchCountBadge.textContent = `共 ${inpaintEditor.batches.length} 轮`;
    }

    elements.inpaintBatchesContainer.innerHTML = "";

    inpaintEditor.batches.forEach((batch, bIdx) => {
      const activeInBatch = batch.candidates.filter((c) => !c.deleted);
      if (activeInBatch.length === 0) return;

      const isLatest = bIdx === 0;
      const batchCard = document.createElement("div");
      batchCard.className = `inpaint-batch-card ${isLatest ? "is-latest" : ""}`;

      const roundTitle = isLatest
        ? `🎯 第 ${batch.roundNumber} 轮 (最新)`
        : `🕒 第 ${batch.roundNumber} 轮`;

      // 批次头部
      const header = document.createElement("div");
      header.className = "inpaint-batch-header";
      header.innerHTML = `
        <div class="inpaint-batch-title-group">
          <span class="inpaint-batch-title">${roundTitle}</span>
          <span class="inpaint-batch-info-tag">强度: ${batch.strength.toFixed(2)}</span>
          <span class="inpaint-batch-info-tag">${activeInBatch.length} 张</span>
          <span class="inpaint-batch-info-tag" style="font-size: 9px;">${batch.timestamp}</span>
        </div>
        <span class="inpaint-batch-toggle-btn">${batch.collapsed ? "▶ 展开" : "▼ 收起"}</span>
      `;
      header.addEventListener("click", () => {
        batch.collapsed = !batch.collapsed;
        renderInpaintCandidates();
      });
      batchCard.appendChild(header);

      if (batch.collapsed) {
        // 折叠状态：显示小缩略图摘要条
        const summary = document.createElement("div");
        summary.className = "inpaint-batch-summary";
        activeInBatch.forEach((cand) => {
          const isActive = inpaintEditor.activeCandidate && inpaintEditor.activeCandidate.batchId === cand.batchId && inpaintEditor.activeCandidate.candidate_id === cand.candidate_id;
          const thumb = document.createElement("img");
          thumb.className = `inpaint-mini-thumb ${isActive ? "active" : ""}`;
          thumb.src = cand.preview_url;
          thumb.alt = `第 ${cand.roundNumber} 轮 #${cand.indexInRound}`;
          thumb.title = `第 ${cand.roundNumber} 轮 #${cand.indexInRound} (Seed: ${cand.seed}) - 点击对比`;
          thumb.addEventListener("click", (e) => {
            e.stopPropagation();
            setupInpaintCompareView(cand);
          });
          summary.appendChild(thumb);
        });
        batchCard.appendChild(summary);
      } else {
        // 展开状态：显示完整 2 列大卡片网格
        const grid = document.createElement("div");
        grid.className = "inpaint-candidates-grid";
        activeInBatch.forEach((cand) => {
          const isActive = inpaintEditor.activeCandidate && inpaintEditor.activeCandidate.batchId === cand.batchId && inpaintEditor.activeCandidate.candidate_id === cand.candidate_id;
          const card = document.createElement("div");
          card.className = `inpaint-candidate-card ${isActive ? "active" : ""}`;
          card.innerHTML = `
            <div class="inpaint-card-img-wrap">
              <img src="${cand.preview_url}" alt="候选图 #${cand.indexInRound}" loading="lazy">
              <span class="inpaint-card-badge">#${cand.indexInRound}</span>
              <div class="inpaint-card-actions ${cand.starred ? "has-active" : ""}">
                <button type="button" class="inpaint-card-star-btn ${cand.starred ? "is-starred" : ""}" title="${cand.starred ? "取消标记" : "标记为心仪候选"}">⭐</button>
                <button type="button" class="inpaint-card-del-btn" title="剔除此废片">✕</button>
              </div>
            </div>
            <div class="inpaint-candidate-meta">
              <span style="font-weight: 600;">第 ${cand.roundNumber} 轮 #${cand.indexInRound}</span>
              <span style="font-size: 9px;">Seed: ${cand.seed}</span>
            </div>
          `;

          // 收藏按钮
          const starBtn = card.querySelector(".inpaint-card-star-btn");
          starBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            cand.starred = !cand.starred;
            renderInpaintCandidates();
          });

          // 剔除按钮
          const delBtn = card.querySelector(".inpaint-card-del-btn");
          delBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            cand.deleted = true;
            if (inpaintEditor.activeCandidate && inpaintEditor.activeCandidate.batchId === cand.batchId && inpaintEditor.activeCandidate.candidate_id === cand.candidate_id) {
              let nextActive = null;
              for (const b of inpaintEditor.batches) {
                const available = b.candidates.filter((c) => !c.deleted);
                if (available.length > 0) {
                  nextActive = available[0];
                  break;
                }
              }
              if (nextActive) {
                setupInpaintCompareView(nextActive);
              } else {
                inpaintEditor.activeCandidate = null;
                if (elements.inpaintCompareWrap) elements.inpaintCompareWrap.classList.add("hidden");
                if (elements.inpaintCanvasWrap) elements.inpaintCanvasWrap.classList.remove("hidden");
              }
            }
            renderInpaintCandidates();
          });

          // 点击卡片进入对比
          card.addEventListener("click", () => {
            setupInpaintCompareView(cand);
          });

          grid.appendChild(card);
        });
        batchCard.appendChild(grid);
      }

      elements.inpaintBatchesContainer.appendChild(batchCard);
    });
  }

  /** 设置 Split Slider 对比视图 */
  function setupInpaintCompareView(cand) {
    if (!cand) return;
    inpaintEditor.activeCandidate = cand;

    const assetId = state.lightbox.activeAssetId;

    // 切换至对比模式
    setInpaintViewMode("compare");

    if (elements.inpaintCompareBefore) {
      elements.inpaintCompareBefore.src = `/api/assets/${encodeURIComponent(assetId)}/preview?v=${Date.now()}`;
    }
    if (elements.inpaintCompareAfter) {
      elements.inpaintCompareAfter.src = cand.preview_url;
    }

    // 更新吸底确认按钮文案
    if (elements.inpaintApplyBtn) {
      elements.inpaintApplyBtn.textContent = `✅ 确认采用选中的图片 (第 ${cand.roundNumber} 轮 #${cand.indexInRound}) 覆盖原图`;
    }

    // 重新刷新批次视图中 active 高亮
    renderInpaintCandidates();

    // 重置滑块位置到 50%
    updateSplitSlider(50);
  }

  /** 初始化 Split Slider 拖拽交互 */
  function initSplitSlider() {
    const wrap = elements.inpaintCompareWrap;
    if (!wrap) return;

    const onDrag = (e) => {
      if (!inpaintEditor.isDraggingSlider) return;
      const target = elements.inpaintCompareInner || wrap;
      const rect = target.getBoundingClientRect();
      if (!rect.width) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const percent = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
      updateSplitSlider(percent);
    };

    const onStart = (e) => {
      inpaintEditor.isDraggingSlider = true;
      onDrag(e);
    };

    const onEnd = () => {
      inpaintEditor.isDraggingSlider = false;
    };

    wrap.addEventListener("mousedown", onStart);
    wrap.addEventListener("touchstart", onStart, { passive: false });
    window.addEventListener("mousemove", onDrag);
    window.addEventListener("touchmove", onDrag, { passive: false });
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchend", onEnd);
  }

  function updateSplitSlider(percent) {
    inpaintEditor.sliderPos = percent;
    if (elements.inpaintCompareAfterWrap) {
      elements.inpaintCompareAfterWrap.style.clipPath = `polygon(${percent}% 0, 100% 0, 100% 100%, ${percent}% 100%)`;
    }
    if (elements.inpaintCompareHandle) {
      elements.inpaintCompareHandle.style.left = `${percent}%`;
    }
  }

  /** 确认采用选中的候选图片并覆盖原图 */
  async function handleInpaintApply() {
    const oldAssetId = state.lightbox.activeAssetId;
    const cand = inpaintEditor.activeCandidate;
    if (!oldAssetId || !cand || !cand.sessionId) return;

    try {
      showNotice(`正在将第 ${cand.roundNumber} 轮 #${cand.indexInRound} 重绘结果安全覆盖原图并更新素材库...`, "info");

      const res = await fetch(`/api/assets/${encodeURIComponent(oldAssetId)}/inpaint/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: cand.sessionId,
          candidate_id: cand.candidate_id,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `覆盖失败 (${res.status})`);
      }

      const applyRes = await res.json();
      const newAssetId = applyRes.new_asset_id || oldAssetId;
      const bustUrl = `/api/assets/${encodeURIComponent(newAssetId)}/preview?v=${Date.now()}`;

      // 1. 同步迁移内存素材缓存 state.loadedAssets
      const oldItem = state.loadedAssets.get(oldAssetId);
      const updatedItem = {
        ...(oldItem || {}),
        asset_id: newAssetId,
        size: applyRes.size_bytes || oldItem?.size,
        mtime: applyRes.mtime || Math.floor(Date.now() / 1000),
        width: applyRes.width || oldItem?.width,
        height: applyRes.height || oldItem?.height,
      };
      state.loadedAssets.delete(oldAssetId);
      state.loadedAssets.set(newAssetId, updatedItem);

      // 2. 同步迁移多选已选素材集合 state.selectedAssetIds
      if (state.selectedAssetIds.has(oldAssetId)) {
        state.selectedAssetIds.delete(oldAssetId);
        state.selectedAssetIds.add(newAssetId);
      }

      // 3. 同步迁移投稿集合列表 state.currentSubmission.sets (all, post, cover)
      let submissionContainsAsset = false;
      const sets = state.currentSubmission.sets || {};
      ["all", "post", "cover"].forEach((tab) => {
        if (Array.isArray(sets[tab])) {
          if (sets[tab].includes(oldAssetId)) {
            submissionContainsAsset = true;
            sets[tab] = sets[tab].map((id) => (id === oldAssetId ? newAssetId : id));
          }
        }
      });
      if (submissionContainsAsset) {
        renderSetItems();
      }

      // 4. 同步迁移数据集列表 state.datasetAssets
      if (Array.isArray(state.datasetAssets)) {
        state.datasetAssets.forEach((a) => {
          if (a.asset_id === oldAssetId) {
            a.asset_id = newAssetId;
          }
        });
      }

      // 5. 同步迁移 Lightbox 列表与当前激活 ID
      if (Array.isArray(state.lightbox.assetList)) {
        state.lightbox.assetList = state.lightbox.assetList.map((id) => (id === oldAssetId ? newAssetId : id));
      }
      state.lightbox.activeAssetId = newAssetId;

      // 6. 刷新中间瀑布流卡片与 DOM 关联
      const oldCard = state.cardElements.get(oldAssetId) || (elements.assetsGrid ? elements.assetsGrid.querySelector(`[data-asset-id="${oldAssetId}"]`) : null);
      if (oldCard) {
        oldCard.dataset.assetId = newAssetId;
        const img = oldCard.querySelector("img");
        if (img) img.src = bustUrl;
        const cb = oldCard.querySelector(".asset-checkbox");
        if (cb) cb.value = newAssetId;
        state.cardElements.delete(oldAssetId);
        state.cardElements.set(newAssetId, oldCard);
      }

      // 7. 若当前已加载的投稿任务包含该素材，自动同步持久化更新该任务
      if (state.currentSubmission.task_id && submissionContainsAsset) {
        try {
          await executeSaveSubmission("🎉 局部重绘图片已覆盖原图，当前投稿任务与集合已自动同步保存！");
        } catch (subErr) {
          console.warn("自动同步保存投稿任务失败:", subErr);
          showNotice("🎉 局部重绘图片已覆盖原图，但同步保存投稿任务遇到提示：" + (subErr.message || subErr), "warning");
        }
      } else {
        showNotice("🎉 局部重绘图片已成功覆盖原图！", "success");
      }

      // 8. 切回查看详情模式并重新渲染
      inpaintEditor.currentAssetId = null;
      inpaintEditor.batches = [];
      inpaintEditor.activeCandidate = null;
      switchLightboxMode("view");
      await renderLightboxCurrent();
    } catch (err) {
      showNotice(`应用覆盖原图失败：${err.message}`, "error");
    }
  }

  /** 放弃本次重绘并清理缓存 */
  async function handleInpaintDiscard() {
    const sessionIds = [...new Set(inpaintEditor.batches.map((b) => b.sessionId).filter(Boolean))];
    for (const sid of sessionIds) {
      try {
        await fetch(`/api/inpaint-cache/${encodeURIComponent(sid)}`, { method: "DELETE" });
      } catch (e) {
        // ignore cleanup error
      }
    }
    inpaintEditor.batches = [];
    inpaintEditor.activeCandidate = null;
    inpaintClearMask();

    setInpaintViewMode("mask");
    if (elements.inpaintTabCompare) elements.inpaintTabCompare.classList.add("hidden");
    if (elements.inpaintResultsSection) elements.inpaintResultsSection.classList.add("hidden");
    if (elements.inpaintStickyFooter) elements.inpaintStickyFooter.classList.add("hidden");
    if (elements.inpaintProgressBox) elements.inpaintProgressBox.classList.add("hidden");
    if (elements.inpaintToggleDiffBtn) elements.inpaintToggleDiffBtn.classList.add("hidden");

    showNotice("已放弃全部重绘修改，原图保持不变", "info");
  }

  function switchLightboxMode(mode) {
    state.lightbox.mode = mode;
    if (elements.lightboxModeTabs) {
      elements.lightboxModeTabs.querySelectorAll("[data-lb-tab]").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.lbTab === mode);
      });
    }

    const body = elements.lightboxContainer ? elements.lightboxContainer.querySelector(".lightbox-body") : null;

    if (mode === "inpaint") {
      if (body) {
        body.classList.remove("mode-edit");
        body.classList.add("mode-inpaint");
      }
      if (elements.lightboxImageArea) elements.lightboxImageArea.classList.add("hidden");
      if (elements.lightboxEditorArea) elements.lightboxEditorArea.classList.add("hidden");
      if (elements.lightboxInpaintArea) elements.lightboxInpaintArea.classList.remove("hidden");

      if (elements.lightboxViewSidebar) elements.lightboxViewSidebar.classList.add("hidden");
      if (elements.lightboxInpaintSidebar) elements.lightboxInpaintSidebar.classList.remove("hidden");

      const assetId = state.lightbox.activeAssetId;
      if (assetId) {
        requestAnimationFrame(() => loadAssetToInpaint(assetId));
      }
    } else if (mode === "edit") {
      if (body) {
        body.classList.remove("mode-inpaint");
        body.classList.add("mode-edit");
      }
      if (elements.lightboxImageArea) elements.lightboxImageArea.classList.add("hidden");
      if (elements.lightboxEditorArea) elements.lightboxEditorArea.classList.remove("hidden");
      if (elements.lightboxInpaintArea) elements.lightboxInpaintArea.classList.add("hidden");

      if (elements.lightboxViewSidebar) elements.lightboxViewSidebar.classList.remove("hidden");
      if (elements.lightboxInpaintSidebar) elements.lightboxInpaintSidebar.classList.add("hidden");

      const item = state.lightbox.exportItem;
      if (item) {
        // 延迟一帧以确保容器可见后再计算尺寸
        requestAnimationFrame(() => loadImageToMosaic(item.preview_url));
      }
    } else {
      if (body) {
        body.classList.remove("mode-edit");
        body.classList.remove("mode-inpaint");
      }
      if (elements.lightboxImageArea) elements.lightboxImageArea.classList.remove("hidden");
      if (elements.lightboxEditorArea) elements.lightboxEditorArea.classList.add("hidden");
      if (elements.lightboxInpaintArea) elements.lightboxInpaintArea.classList.add("hidden");

      if (elements.lightboxViewSidebar) elements.lightboxViewSidebar.classList.remove("hidden");
      if (elements.lightboxInpaintSidebar) elements.lightboxInpaintSidebar.classList.add("hidden");
    }
  }

  async function openExportedLightbox(index, imgList, tabName) {
    if (!imgList || !imgList[index]) return;
    const item = imgList[index];
    state.lightbox.activeAssetId = null;
    state.lightbox.assetList = [];
    state.lightbox.currentIndex = index;
    state.lightbox.isExported = true;
    state.lightbox.exportItem = item;
    state.lightbox.exportTabName = tabName;

    const taskId = state.currentSubmission?.task_id || state.latestBuildData?.task_id;

    // 显示模式切换页签栏
    if (elements.lightboxModeTabs) {
      elements.lightboxModeTabs.classList.remove("hidden");
      const tabView = elements.lightboxModeTabs.querySelector('[data-lb-tab="view"]');
      const tabInpaint = elements.lightboxModeTabs.querySelector('[data-lb-tab="inpaint"]');
      const tabEdit = elements.lightboxModeTabs.querySelector('[data-lb-tab="edit"]');
      if (tabView) tabView.classList.remove("hidden");
      if (tabInpaint) tabInpaint.classList.add("hidden");
      if (tabEdit) tabEdit.classList.remove("hidden");
    }
    switchLightboxMode("view");

    elements.previewImage.src = item.preview_url;
    elements.previewImage.alt = item.filename;
    elements.lightboxFilename.textContent = `[导出成品·${tabName}] ${item.filename}`;
    const outDir = state.latestBuildData?.output_dir || "";
    elements.lightboxFilepath.textContent = outDir ? `${outDir}\\output\\${tabName}\\${item.filename}` : item.filename;
    elements.lightboxCounter.textContent = `${index + 1} / ${imgList.length}`;

    // 隐藏打码和收藏按钮，这是成品图
    elements.lightboxFavoriteBtn.classList.add("hidden");
    elements.lightboxPostedBtn.classList.add("hidden");

    // 初始重置元数据面板（正在从文件解析...）
    const kb = Math.round((item.size_bytes || 0) / 1024);
    elements.lbMetaDimensions.textContent = "读取中...";
    elements.lbMetaSize.textContent = `${kb} KB`;
    elements.lbMetaMtime.textContent = "-";

    elements.lbMetaSeed.textContent = "-";
    elements.lbMetaModel.textContent = "-";
    elements.lbMetaSampler.textContent = "-";
    elements.lbMetaSteps.textContent = "-";
    elements.lbMetaScale.textContent = "-";
    elements.lbMetaNoise.textContent = "-";

    elements.lbNodeArtist.textContent = "-";
    elements.lbNodeCharacter.textContent = "-";
    elements.lbNodeGroup.textContent = "-";
    elements.lbNodeAction.textContent = "-";
    if (elements.lbFacetsSection) {
      elements.lbFacetsSection.hidden = true;
    }

    elements.lbPromptBox.textContent = "读取中...";
    elements.lbNegativeBox.textContent = "读取中...";
    elements.lbRawParameters.textContent = "读取中...";

    elements.lightboxPrevBtn.disabled = index <= 0;
    elements.lightboxNextBtn.disabled = index >= imgList.length - 1;

    // 绑定前后切换
    elements.lightboxPrevBtn.onclick = (e) => {
      e.stopPropagation();
      if (index > 0) openExportedLightbox(index - 1, imgList, tabName);
    };
    elements.lightboxNextBtn.onclick = (e) => {
      e.stopPropagation();
      if (index < imgList.length - 1) openExportedLightbox(index + 1, imgList, tabName);
    };

    if (!elements.previewDialog.open) {
      elements.previewDialog.showModal();
    }

    // 真实从磁盘上的导出文件读取元数据并渲染，不伪造任何内容
    if (taskId && item.filename) {
      try {
        const res = await fetch(
          `/api/submissions/${encodeURIComponent(taskId)}/build-images/${encodeURIComponent(tabName)}/${encodeURIComponent(item.filename)}/details`
        );
        if (res.ok && state.lightbox.isExported && state.lightbox.exportItem?.filename === item.filename) {
          const detail = await res.json();
          const gen = detail.generation_info || {};

          elements.lbMetaDimensions.textContent = `${detail.width} × ${detail.height} (${detail.image_format || "PNG"})`;
          elements.lbMetaSize.textContent = gen.file_size_human || `${kb} KB`;
          elements.lbMetaMtime.textContent = gen.modified_at || "-";

          elements.lbMetaSeed.textContent = gen.seed !== null && gen.seed !== undefined ? String(gen.seed) : "-";
          elements.lbMetaModel.textContent = gen.model || "-";
          elements.lbMetaSampler.textContent = gen.sampler || "-";
          elements.lbMetaSteps.textContent = gen.steps !== null && gen.steps !== undefined ? String(gen.steps) : "-";
          elements.lbMetaScale.textContent = gen.scale !== null && gen.scale !== undefined ? String(gen.scale) : "-";
          elements.lbMetaNoise.textContent = gen.noise_schedule || "-";

          elements.lbPromptBox.textContent = gen.prompt || "无 Prompt 记录";
          elements.lbNegativeBox.textContent = gen.negative_prompt || "无 Negative 记录";

          elements.lbRawParameters.textContent =
            gen.raw_parameters ||
            (gen.all_chunks && Object.keys(gen.all_chunks).length
              ? JSON.stringify(gen.all_chunks, null, 2)
              : "无原始参数");
        }
      } catch (err) {
        console.warn("读取导出文件元数据失败", err);
      }
    }
  }

  async function handleStartExport() {
    const taskId = state.currentSubmission.task_id;
    if (!taskId) return;
    clearNotice();
    resetExportUI();

    const enableMosaic = elements.exportMosaicToggle ? elements.exportMosaicToggle.checked : true;
    const pixelSize = elements.exportMosaicPixelSize ? parseInt(elements.exportMosaicPixelSize.value, 10) || 10 : 10;

    try {
      const res = await fetch(`/api/submissions/${encodeURIComponent(taskId)}/exports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enable_mosaic: enableMosaic,
          mosaic_pixel_size: pixelSize,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail?.message || `启动导出失败 (${res.status})`);
      }
      const job = await res.json();
      handleExportJobUpdate(job);
    } catch (err) {
      showNotice(err.message, "error");
    }
  }

  function handleExportJobUpdate(job) {
    state.activeExportJob = job;

    if (job.status === "queued" || job.status === "running") {
      elements.exportProgressBox.classList.remove("hidden");
      elements.exportCompletedBox.classList.add("hidden");
      elements.exportErrorBox.classList.add("hidden");
      elements.startExportBtn.disabled = true;

      elements.progressBarFill.style.width = `${job.percent || 0}%`;
      elements.progressPhase.textContent = `阶段: ${job.phase || job.status} (${job.processed || 0}/${job.total || 0})`;
      elements.progressPercent.textContent = `${job.percent || 0}%`;
      elements.progressFile.textContent = job.current_filename || "";

      if (!state.exportPollTimer) {
        state.exportPollTimer = setInterval(pollActiveExport, 1000);
      }
    } else if (job.status === "completed") {
      if (state.exportPollTimer) {
        clearInterval(state.exportPollTimer);
        state.exportPollTimer = null;
      }
      elements.exportProgressBox.classList.add("hidden");
      elements.exportErrorBox.classList.add("hidden");
      elements.startExportBtn.disabled = false;
      if (state.currentSubmission.task_id) {
        loadLatestBuildDetails(state.currentSubmission.task_id);
      }
    } else if (job.status === "failed" || job.status === "interrupted") {
      if (state.exportPollTimer) {
        clearInterval(state.exportPollTimer);
        state.exportPollTimer = null;
      }
      elements.exportProgressBox.classList.add("hidden");
      elements.exportCompletedBox.classList.add("hidden");
      elements.exportErrorBox.classList.remove("hidden");
      elements.exportErrorText.textContent = `导出失败: ${job.error || "任务中断"}`;
      elements.startExportBtn.disabled = false;
    }
  }

  async function pollActiveExport() {
    if (!state.activeExportJob?.job_id) return;
    try {
      const res = await fetch(`/api/export-jobs/${encodeURIComponent(state.activeExportJob.job_id)}`);
      if (res.ok) {
        const job = await res.json();
        handleExportJobUpdate(job);
      }
    } catch (err) {
      console.warn("轮询导出状态失败", err);
    }
  }

  async function handleOpenExportDir() {
    const taskId = state.currentSubmission?.task_id || state.latestBuildData?.task_id;
    if (!taskId) {
      showNotice("请先选择一个投稿任务", "warning");
      return;
    }
    try {
      const res = await fetch(`/api/submissions/${encodeURIComponent(taskId)}/open-latest-build`, {
        method: "POST",
      });
      if (res.ok) {
        showNotice("已在资源管理器中打开导出目录", "info");
      } else {
        const errData = await res.json().catch(() => ({}));
        showNotice(errData.detail || `打开目录失败 (${res.status})`, "error");
      }
    } catch (err) {
      showNotice(`打开目录失败: ${err.message}`, "error");
    }
  }

  // ================= 页面初始化与 URL 参数处理 =================

  async function initFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const submissionId = params.get("submission_id");
    const planId = params.get("plan_id");
    const entryId = params.get("entry_id");

    if (submissionId) {
      await loadSubmissionDetail(submissionId);
    } else if (planId && entryId) {
      await loadLegacyInlineFromPlan(planId, entryId);
    }
  }

  async function loadLegacyInlineFromPlan(planId, entryId) {
    try {
      const res = await fetch(`/api/plans/${encodeURIComponent(planId)}`);
      if (res.ok) {
        const plan = await res.json();
        const entry = (plan.entries || []).find((e) => e.entry_id === entryId);
        if (entry && entry.content?.kind === "inline_selection") {
          state.currentSubmission = {
            task_id: null,
            title: entry.title || "从计划导入的散图",
            source_import_id: entry.content.source_import_id || null,
            revision: 1,
            sets: {
              all: entry.content.sets?.all || [],
              post: entry.content.sets?.post || [],
              cover: entry.content.sets?.cover || [],
            },
            currentSetTab: "all",
            legacyInlineSource: {
              plan_id: planId,
              entry_id: entryId,
              plan_revision: plan.revision,
            },
          };
          elements.legacyConvertBanner.classList.remove("hidden");
          syncSubmissionFormUI();
        }
      }
    } catch (err) {
      console.warn("从计划加载散图失败", err);
    }
  }

  // ================= 事件绑定 =================

  // 快照选择器交互事件
  if (elements.snapshotPickerTrigger) {
    elements.snapshotPickerTrigger.addEventListener("click", (e) => {
      if (e.target.closest(".snapshot-picker-clear")) return;
      if (elements.snapshotPickerDropdown.classList.contains("hidden")) {
        openSnapshotDropdown();
      } else {
        closeSnapshotDropdown();
      }
    });

    elements.snapshotPickerTrigger.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (elements.snapshotPickerDropdown.classList.contains("hidden")) {
          openSnapshotDropdown();
        } else {
          closeSnapshotDropdown();
        }
      } else if (e.key === "Escape") {
        closeSnapshotDropdown();
      }
    });
  }

  if (elements.snapshotPickerClear) {
    elements.snapshotPickerClear.addEventListener("click", (e) => {
      e.stopPropagation();
      switchSnapshot([]);
    });
  }

  if (elements.snapshotPickerSearch) {
    elements.snapshotPickerSearch.addEventListener("input", (e) => {
      state.snapshotSearchQuery = e.target.value;
      renderSnapshotList();
    });
    elements.snapshotPickerSearch.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeSnapshotDropdown();
      }
    });
  }

  if (elements.snapshotSelectAll) {
    elements.snapshotSelectAll.addEventListener("click", () => {
      const allIds = state.allImports.map((imp) => imp.import_id).filter(Boolean);
      switchSnapshot(allIds);
    });
  }

  if (elements.snapshotSelectNone) {
    elements.snapshotSelectNone.addEventListener("click", () => {
      switchSnapshot([]);
    });
  }

  if (elements.snapshotSelectGlobal) {
    elements.snapshotSelectGlobal.addEventListener("click", () => {
      switchSnapshot(["__all__"]);
      closeSnapshotDropdown();
    });
  }

  // 点击组件外部自动关闭下拉框
  document.addEventListener("click", (e) => {
    if (elements.snapshotPicker && !elements.snapshotPicker.contains(e.target)) {
      closeSnapshotDropdown();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeSnapshotDropdown();
    }
  });

  if (elements.importSelect) {
    elements.importSelect.addEventListener("change", (e) => {
      switchSnapshot(e.target.value ? [e.target.value] : []);
    });
  }

  function applyTextSearch() {
    const val = elements.textFilter.value.trim();
    if (state.filters.text !== val) {
      state.filters.text = val;
      applyInstantFilters();
    }
  }

  let textSearchTimer = null;
  elements.textFilter.addEventListener("input", () => {
    state.filters.text = elements.textFilter.value.trim();
    clearTimeout(textSearchTimer);
    textSearchTimer = setTimeout(() => {
      applyInstantFilters();
    }, 250);
  });

  elements.textFilter.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      clearTimeout(textSearchTimer);
      applyTextSearch();
    }
  });

  elements.searchAssetsBtn.addEventListener("click", () => {
    clearTimeout(textSearchTimer);
    applyTextSearch();
  });

  // 快速筛选（收藏与投稿三态分段选择器）事件
  function syncQuickFilterButtons() {
    if (!elements.quickFilterSection) return;
    const favRow = elements.quickFilterSection.querySelector('[data-filter-type="favorite"]');
    if (favRow) {
      favRow.querySelectorAll(".segment-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.val === state.filters.favorite_mode);
      });
    }
    const postRow = elements.quickFilterSection.querySelector('[data-filter-type="posted"]');
    if (postRow) {
      postRow.querySelectorAll(".segment-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.val === state.filters.posted_mode);
      });
    }
  }

  if (elements.quickFilterSection) {
    elements.quickFilterSection.addEventListener("click", (e) => {
      const btn = e.target.closest(".segment-btn");
      if (!btn) return;
      const row = btn.closest(".quick-filter-row");
      if (!row) return;
      const filterType = row.dataset.filterType;
      const val = btn.dataset.val;

      if (filterType === "favorite") {
        state.filters.favorite_mode = val;
      } else if (filterType === "posted") {
        state.filters.posted_mode = val;
      }

      syncQuickFilterButtons();
      loadAssetsPage(true);
    });
  }

  elements.resetFiltersBtn.addEventListener("click", () => {
    state.filters = {
      import_id: state.filters.import_id,
      text: "",
      artist: "",
      character: "",
      action_group: "",
      action: "",
      facets: {},
      tags: new Set(),
      favorite_mode: "all",
      posted_mode: "all",
      sort_by: state.filters.sort_by || "order_asc",
    };
    elements.textFilter.value = "";
    elements.artistFilter.value = "";
    elements.characterFilter.value = "";
    elements.groupFilter.value = "";
    elements.actionFilter.value = "";
    document.querySelectorAll(".node-clear").forEach((btn) => (btn.hidden = true));
    syncQuickFilterButtons();
    renderFacetAccordion();
    renderTagChips();
    applyInstantFilters();
  });

  if (elements.clearTagFiltersBtn) {
    elements.clearTagFiltersBtn.addEventListener("click", () => {
      state.filters.tags.clear();
      renderTagChips();
      applyInstantFilters();
    });
  }

  if (elements.clearAllChips) {
    elements.clearAllChips.addEventListener("click", () => {
      elements.resetFiltersBtn.click();
    });
  }

  if (elements.clearFacetsBtn) {
    elements.clearFacetsBtn.addEventListener("click", () => {
      state.filters.facets = {};
      renderFacetAccordion();
      loadAssetsPage(true);
    });
  }

  // ================= 瀑布流卡片尺寸调节 =================
  function applyCardSize(sizePx, save = true) {
    const size = Math.max(100, Math.min(400, parseInt(sizePx, 10) || 170));
    if (elements.assetWaterfall) {
      elements.assetWaterfall.style.setProperty("--waterfall-card-size", `${size}px`);
    }
    if (elements.cardSizeSlider) {
      elements.cardSizeSlider.value = String(size);
    }
    if (elements.cardSizeVal) {
      elements.cardSizeVal.textContent = `${size}px`;
    }
    if (save) {
      localStorage.setItem("library_card_size", String(size));
    }
  }

  // 初始化恢复用户偏好的瀑布流卡片尺寸
  const savedCardSize = localStorage.getItem("library_card_size") || "170";
  applyCardSize(savedCardSize, false);

  if (elements.cardSizeSlider) {
    elements.cardSizeSlider.addEventListener("input", (e) => {
      applyCardSize(e.target.value, false);
    });
    elements.cardSizeSlider.addEventListener("change", (e) => {
      applyCardSize(e.target.value, true);
    });
    elements.cardSizeSlider.addEventListener("dblclick", () => {
      applyCardSize(170, true);
    });
  }

  // 排序下拉切换
  if (elements.sortSelect) {
    elements.sortSelect.value = state.filters.sort_by;
    elements.sortSelect.addEventListener("change", (e) => {
      state.filters.sort_by = e.target.value;
      localStorage.setItem("library_sort_by", state.filters.sort_by);
      loadAssetsPage(true);
    });
  }

  // 全选 / 清选 / 加入集合
  elements.selectAllVisibleBtn.addEventListener("click", () => {
    state.loadedAssets.forEach((item, id) => {
      state.selectedAssetIds.add(id);
    });
    updateSelectionBadges();
  });

  // 瀑布流滚动触底监听 (真·按需分页加载)
  if (elements.scrollSentinel) {
    const scrollObserver = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          state.hasMore &&
          !state.loadingPage &&
          state.filters.import_id
        ) {
          loadAssetsPage(false);
        }
      },
      { rootMargin: "400px" }
    );
    scrollObserver.observe(elements.scrollSentinel);
  }

  elements.clearSelectionBtn.addEventListener("click", () => {
    clearAllAssetSelection();
  });

  elements.addToSetBtn.addEventListener("click", () => {
    if (!state.selectedAssetIds.size) {
      showNotice("请先勾选需要加入的素材", "warning");
      return;
    }
    const count = state.selectedAssetIds.size;
    const activeSet = state.currentSubmission.currentSetTab;
    const currentList = state.currentSubmission.sets[activeSet];
    for (const id of state.selectedAssetIds) {
      if (!currentList.includes(id)) {
        currentList.push(id);
      }
    }
    syncSubmissionFormUI();
    // 需求 3：点击加入集合后自动清选
    clearAllAssetSelection();
    showNotice(`已将 ${count} 项素材加入【${activeSet}】集合，并已自动清选`, "info");

    // 若当前为新建投稿且尚未生成标题，自动基于当前选集触发标题与推荐标签获取
    if (!state.currentSubmission.task_id) {
      fetchMetadataSuggestions(state.currentSubmission.sets.all, true);
    }
  });

  // 集合 Tab 切换
  elements.tabAll.addEventListener("click", () => {
    state.currentSubmission.currentSetTab = "all";
    syncSubmissionFormUI();
  });
  elements.tabPost.addEventListener("click", () => {
    state.currentSubmission.currentSetTab = "post";
    syncSubmissionFormUI();
  });
  elements.tabCover.addEventListener("click", () => {
    state.currentSubmission.currentSetTab = "cover";
    syncSubmissionFormUI();
  });

  // 清空当前集合
  if (elements.clearCurrentSetBtn) {
    elements.clearCurrentSetBtn.addEventListener("click", () => {
      const activeSet = state.currentSubmission.currentSetTab;
      state.currentSubmission.sets[activeSet] = [];
      syncSubmissionFormUI();
      showNotice(`已清空【${activeSet}】集合`, "info");
    });
  }

  // 快捷排期预设芯片
  document.querySelectorAll(".schedule-quick-presets .preset-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const offset = parseInt(chip.dataset.offsetDays, 10) || 0;
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + offset);
      const y = targetDate.getFullYear();
      const m = String(targetDate.getMonth() + 1).padStart(2, "0");
      const d = String(targetDate.getDate()).padStart(2, "0");
      if (elements.submissionDate) {
        elements.submissionDate.value = `${y}-${m}-${d}`;
      }
    });
  });

  if (elements.clearScheduleBtn) {
    elements.clearScheduleBtn.addEventListener("click", () => {
      if (elements.submissionDate) elements.submissionDate.value = "";
    });
  }

  // Pixiv 投稿设定事件绑定
  if (elements.pixivAutoBtn) {
    elements.pixivAutoBtn.addEventListener("click", () => {
      fetchMetadataSuggestions(state.currentSubmission.sets.all, true);
      showNotice("已重新提取角色标题与推荐标签", "info");
    });
  }

  // Pixiv 缩略图与裁剪事件绑定
  if (elements.openPixivCropBtn) {
    elements.openPixivCropBtn.addEventListener("click", () => {
      openPixivCropDialog();
    });
  }

  if (elements.pixivCropResetBtn) {
    elements.pixivCropResetBtn.addEventListener("click", async () => {
      if (!state.currentSubmission.pixiv) {
        state.currentSubmission.pixiv = {};
      }
      state.currentSubmission.pixiv.crop_x = null;
      state.currentSubmission.pixiv.crop_y = null;
      updatePixivThumbnailPreview();
      if (state.currentSubmission.task_id) {
        try {
          await executeSaveSubmission("✓ 已重置并成功保存 Pixiv 官方默认裁剪比例");
        } catch (err) {
          showNotice(`重置保存失败: ${err.message}`, "error");
        }
      } else {
        showNotice("已重置为 Pixiv 官方默认裁剪比例", "info");
      }
    });
  }

  if (elements.closeCropDialogBtn) {
    elements.closeCropDialogBtn.addEventListener("click", () => {
      if (elements.pixivCropDialog) elements.pixivCropDialog.close();
    });
  }

  if (elements.cropCancelBtn) {
    elements.cropCancelBtn.addEventListener("click", () => {
      if (elements.pixivCropDialog) elements.pixivCropDialog.close();
    });
  }

  if (elements.cropApplyBtn) {
    elements.cropApplyBtn.addEventListener("click", async () => {
      if (!state.currentSubmission.pixiv) {
        state.currentSubmission.pixiv = {};
      }
      const isHorizontal = cropState.orientation === "horizontal";
      const isVertical = cropState.orientation === "vertical";
      state.currentSubmission.pixiv.crop_x = isHorizontal ? Number(cropState.tempCropX) : 0;
      state.currentSubmission.pixiv.crop_y = isVertical ? Number(cropState.tempCropY) : 0;
      if (elements.pixivCropDialog) elements.pixivCropDialog.close();
      updatePixivThumbnailPreview();

      if (state.currentSubmission.task_id) {
        try {
          await executeSaveSubmission("✓ 已应用并成功保存 Pixiv 缩略图裁剪位置");
        } catch (err) {
          showNotice(`保存失败: ${err.message}`, "error");
        }
      } else {
        showNotice("✓ 已应用裁剪比例（新建投稿请点击「💾 保存投稿」以生成任务）", "info");
      }
    });
  }

  // 快捷预设按钮
  if (elements.cropPresetStartBtn) {
    elements.cropPresetStartBtn.addEventListener("click", () => {
      if (cropState.orientation === "horizontal") {
        cropState.tempCropX = 0;
      } else if (cropState.orientation === "vertical") {
        cropState.tempCropY = 0;
      }
      if (elements.cropRangeSlider) elements.cropRangeSlider.value = "0";
      renderCropModalTransforms();
    });
  }

  if (elements.cropPresetCenterBtn) {
    elements.cropPresetCenterBtn.addEventListener("click", () => {
      if (cropState.orientation === "horizontal") {
        cropState.tempCropX = cropState.maxCropX / 2;
      } else if (cropState.orientation === "vertical") {
        cropState.tempCropY = cropState.maxCropY / 2;
      }
      if (elements.cropRangeSlider) elements.cropRangeSlider.value = "500";
      renderCropModalTransforms();
    });
  }

  if (elements.cropPresetEndBtn) {
    elements.cropPresetEndBtn.addEventListener("click", () => {
      if (cropState.orientation === "horizontal") {
        cropState.tempCropX = cropState.maxCropX;
      } else if (cropState.orientation === "vertical") {
        cropState.tempCropY = cropState.maxCropY;
      }
      if (elements.cropRangeSlider) elements.cropRangeSlider.value = "1000";
      renderCropModalTransforms();
    });
  }

  // 滑块事件
  if (elements.cropRangeSlider) {
    elements.cropRangeSlider.addEventListener("input", (e) => {
      const ratio = parseInt(e.target.value, 10) / 1000;
      if (cropState.orientation === "horizontal") {
        cropState.tempCropX = ratio * cropState.maxCropX;
      } else if (cropState.orientation === "vertical") {
        cropState.tempCropY = ratio * cropState.maxCropY;
      }
      renderCropModalTransforms();
    });
  }

  // 视口鼠标/触控拖拽
  const cropStageViewportEl = elements.cropStage || elements.cropViewportFrame;
  if (cropStageViewportEl) {
    const onCropDragStart = (clientX, clientY) => {
      if (cropState.orientation === "square") return;
      cropState.isDragging = true;
      cropState.startX = clientX;
      cropState.startY = clientY;
      cropState.startCropX = cropState.tempCropX;
      cropState.startCropY = cropState.tempCropY;
      if (elements.cropStage) elements.cropStage.classList.add("grabbing");
    };

    const onCropDragMove = (clientX, clientY) => {
      if (!cropState.isDragging) return;
      const deltaX = clientX - cropState.startX;
      const deltaY = clientY - cropState.startY;

      // 视口中央方形选框尺寸为 280px，严格按照 Pixiv 官方比例计算平移
      if (cropState.orientation === "horizontal" && cropState.height > 0) {
        const scaledW = 280 * (cropState.width / cropState.height);
        const deltaCropX = - (deltaX / scaledW);
        cropState.tempCropX = Math.max(0, Math.min(cropState.maxCropX, cropState.startCropX + deltaCropX));
        if (elements.cropRangeSlider && cropState.maxCropX > 0) {
          elements.cropRangeSlider.value = String(Math.round((cropState.tempCropX / cropState.maxCropX) * 1000));
        }
      } else if (cropState.orientation === "vertical" && cropState.width > 0) {
        const scaledH = 280 * (cropState.height / cropState.width);
        const deltaCropY = - (deltaY / scaledH);
        cropState.tempCropY = Math.max(0, Math.min(cropState.maxCropY, cropState.startCropY + deltaCropY));
        if (elements.cropRangeSlider && cropState.maxCropY > 0) {
          elements.cropRangeSlider.value = String(Math.round((cropState.tempCropY / cropState.maxCropY) * 1000));
        }
      }
      renderCropModalTransforms();
    };

    const onCropDragEnd = () => {
      if (!cropState.isDragging) return;
      cropState.isDragging = false;
      if (elements.cropStage) elements.cropStage.classList.remove("grabbing");
    };

    cropStageViewportEl.addEventListener("mousedown", (e) => {
      e.preventDefault();
      onCropDragStart(e.clientX, e.clientY);
    });
    window.addEventListener("mousemove", (e) => {
      if (cropState.isDragging) onCropDragMove(e.clientX, e.clientY);
    });
    window.addEventListener("mouseup", () => {
      if (cropState.isDragging) onCropDragEnd();
    });

    cropStageViewportEl.addEventListener("touchstart", (e) => {
      if (e.touches.length === 1) {
        onCropDragStart(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });
    window.addEventListener("touchmove", (e) => {
      if (cropState.isDragging && e.touches.length === 1) {
        onCropDragMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });
    window.addEventListener("touchend", () => {
      if (cropState.isDragging) onCropDragEnd();
    });
  }

  async function handlePublishToPixiv(forceRepublish = false) {
    const sub = state.currentSubmission;
    if (!sub || !sub.task_id) {
      showNotice("请先保存投稿任务后再发布到 Pixiv", "warning");
      return;
    }

    // 1. 同步当前表单上的标题/简介/标签到 state
    if (elements.pixivTitleInput && sub.pixiv) {
      sub.pixiv.title = elements.pixivTitleInput.value.trim();
    }
    if (elements.pixivCaptionInput && sub.pixiv) {
      sub.pixiv.caption = elements.pixivCaptionInput.value.trim();
    }

    // 2. 标签前置校验与自动补充
    if (!sub.pixiv || !sub.pixiv.tags || sub.pixiv.tags.length === 0) {
      if (sub.pixiv && sub.pixiv.suggested_tags && sub.pixiv.suggested_tags.length > 0) {
        sub.pixiv.tags = sub.pixiv.suggested_tags.slice(0, 10);
        renderPixivMetadataUI();
        showNotice("已自动应用推荐标签", "info");
      } else if (state.tagSuggestions.default_tags && state.tagSuggestions.default_tags.length > 0) {
        sub.pixiv.tags = state.tagSuggestions.default_tags.slice(0, 10);
        renderPixivMetadataUI();
        showNotice("已自动应用默认标签", "info");
      } else {
        showNotice("请至少添加 1 个 Pixiv 标签（或点击「图片识别」「拉取常用」）后再发布", "warning");
        return;
      }
    }

    if (sub.pixiv.tags.length > 10) {
      showNotice("Pixiv 最多允许 10 个标签，发布时将自动截取前 10 个", "warning");
    }

    if (forceRepublish) {
      if (!confirm("该投稿已在 Pixiv 发布过，确定要再次上传并创建为新作品吗？")) {
        return;
      }
    }

    if (elements.publishToPixivBtn) {
      elements.publishToPixivBtn.disabled = true;
      elements.publishToPixivBtn.textContent = "⏳ 正在上传图片并发布中...";
    }
    if (elements.republishToPixivBtn) {
      elements.republishToPixivBtn.disabled = true;
    }

    try {
      // 3. 发布前自动保存投稿配置，确保最新设置落盘
      const savePayload = {
        task_id: sub.task_id,
        title: elements.submissionTitle.value.trim() || sub.title,
        source_import_id: sub.source_import_id,
        sets: sub.sets,
        pixiv: sub.pixiv,
        revision: sub.task_id ? sub.revision : null,
        scheduled_at: sub.scheduled_at,
      };
      let saveRes;
      if (sub.task_id) {
        saveRes = await fetch(`/api/submissions/${encodeURIComponent(sub.task_id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(savePayload),
        });
      } else {
        saveRes = await fetch("/api/submissions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(savePayload),
        });
      }
      if (saveRes.ok) {
        const savedData = await saveRes.json();
        sub.task_id = savedData.task_id;
        sub.revision = savedData.revision;
      } else {
        console.warn("发布前自动保存投稿失败");
      }

      // 4. 调用发布 API
      const res = await fetch(`/api/submissions/${encodeURIComponent(sub.task_id)}/publish/pixiv`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          force_rebuild: false,
          force_republish: forceRepublish,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = data.detail || {};
        const msg = detail.message || (typeof data.detail === "string" ? data.detail : "发布到 Pixiv 失败");
        throw new Error(msg);
      }

      if (sub.pixiv) {
        sub.pixiv.illust_id = data.illust_id;
        sub.pixiv.published_at = data.published_at;
        sub.pixiv.last_publish_status = "success";
      }

      renderPixivMetadataUI();
      showNotice(`🎉 ${data.message || "发布成功！"}`, "info");
    } catch (err) {
      showNotice(`发布到 Pixiv 失败: ${err.message}`, "error");
      renderPixivMetadataUI();
    } finally {
      if (elements.publishToPixivBtn) {
        elements.publishToPixivBtn.disabled = false;
        elements.publishToPixivBtn.textContent = sub.pixiv?.illust_id
          ? `✓ 已发布 (PID: ${sub.pixiv.illust_id})`
          : "🚀 发布到 Pixiv";
      }
      if (elements.republishToPixivBtn) {
        elements.republishToPixivBtn.disabled = false;
      }
    }
  }

  if (elements.pixivCaption) {
    elements.pixivCaption.addEventListener("input", (e) => {
      if (state.currentSubmission.pixiv) {
        state.currentSubmission.pixiv.caption = e.target.value;
      }
    });
  }

  if (elements.pixivR18) {
    elements.pixivR18.addEventListener("change", (e) => {
      if (state.currentSubmission.pixiv) {
        state.currentSubmission.pixiv.r18 = e.target.checked;
      }
    });
  }

  if (elements.pixivAllowTagEdit) {
    elements.pixivAllowTagEdit.addEventListener("change", (e) => {
      if (state.currentSubmission.pixiv) {
        state.currentSubmission.pixiv.allow_tag_edit = e.target.checked;
      }
    });
  }

  if (elements.clearPixivTagsBtn) {
    elements.clearPixivTagsBtn.addEventListener("click", () => {
      if (state.currentSubmission.pixiv) {
        state.currentSubmission.pixiv.tags = [];
        renderPixivMetadataUI();
      }
    });
  }

  if (elements.addPixivCustomTagBtn && elements.pixivCustomTagInput) {
    const handleAddCustomTag = () => {
      const val = elements.pixivCustomTagInput.value.trim();
      if (val) {
        addPixivTag(val);
        elements.pixivCustomTagInput.value = "";
      }
    };
    elements.addPixivCustomTagBtn.addEventListener("click", handleAddCustomTag);
    elements.pixivCustomTagInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAddCustomTag();
      }
    });
  }

  if (elements.fetchPixivOnlineTagsBtn) {
    elements.fetchPixivOnlineTagsBtn.addEventListener("click", async () => {
      const sub = state.currentSubmission;
      const targetId = sub.sets.cover[0] || sub.sets.post[0] || sub.sets.all[0];
      if (!targetId) {
        showNotice("当前集合中没有图片可供识别", "warning");
        return;
      }
      elements.fetchPixivOnlineTagsBtn.disabled = true;
      elements.fetchPixivOnlineTagsBtn.textContent = "识别中...";
      try {
        const res = await fetch("/api/submissions/suggest-pixiv-tags", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            asset_id: targetId,
            import_id: sub.source_import_id || null,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const tags = data.tags || [];
          state.tagSuggestions.pixiv = tags;
          if (state.currentSubmission.pixiv) {
            state.currentSubmission.pixiv.suggested_tags = tags;
          }
          renderPixivMetadataUI();
          if (tags.length) {
            showNotice(`已获取到 ${tags.length} 个 Pixiv 识别推荐标签并绑定到投稿`, "info");
          } else {
            showNotice("Pixiv 未返回识别标签（可能未配置 Cookie 或网络不可达）", "warning");
          }
        } else {
          showNotice("获取 Pixiv 识别标签失败", "error");
        }
      } catch (err) {
        showNotice(`获取 Pixiv 识别标签失败: ${err.message}`, "error");
      } finally {
        elements.fetchPixivOnlineTagsBtn.disabled = false;
        elements.fetchPixivOnlineTagsBtn.textContent = "🔍 图片识别";
      }
    });
  }

  if (elements.syncPixivPastTagsBtn) {
    elements.syncPixivPastTagsBtn.addEventListener("click", async () => {
      elements.syncPixivPastTagsBtn.disabled = true;
      elements.syncPixivPastTagsBtn.textContent = "同步中...";
      try {
        const res = await fetch("/api/submissions/sync-pixiv-past-tags", {
          method: "POST",
        });
        const data = await res.json();
        if (res.ok) {
          state.tagSuggestions.preset = data.tags || [];
          renderPixivMetadataUI();
          showNotice(`已成功从 Pixiv 同步 ${data.count} 个常用标签！`, "info");
        } else {
          showNotice(data.detail?.message || data.detail || "同步常用标签失败", "error");
        }
      } catch (err) {
        showNotice(`同步常用标签失败: ${err.message}`, "error");
      } finally {
        elements.syncPixivPastTagsBtn.disabled = false;
        elements.syncPixivPastTagsBtn.textContent = "🔄 从Pixiv同步";
      }
    });
  }



  async function handleToggleSchedulePublish() {
    const sub = state.currentSubmission;
    if (!sub || !sub.task_id) {
      showNotice("请先保存投稿任务后再开启定时发布", "warning");
      return;
    }

    const enabling = !sub.scheduled_publish;
    if (enabling) {
      // 1. 同步当前表单上的标题/简介/标签到 state
      if (elements.pixivCaption) {
        sub.pixiv.caption = elements.pixivCaption.value.trim();
      }
      const dateVal = elements.submissionDate?.value?.trim();
      const timeVal = elements.submissionTime?.value?.trim() || "20:00";
      if (!dateVal) {
        showNotice("请先在上方设置排期日期（如 2026-08-25）与时间", "warning");
        return;
      }
      sub.scheduled_at = `${dateVal}T${timeVal}:00+08:00`;

      // 2. 标签校验与兜底
      if (!sub.pixiv.tags || sub.pixiv.tags.length === 0) {
        if (sub.pixiv.suggested_tags && sub.pixiv.suggested_tags.length > 0) {
          sub.pixiv.tags = sub.pixiv.suggested_tags.slice(0, 10);
        } else if (state.tagSuggestions.default_tags && state.tagSuggestions.default_tags.length > 0) {
          sub.pixiv.tags = state.tagSuggestions.default_tags.slice(0, 10);
        } else {
          showNotice("请至少添加 1 个 Pixiv 标签后再开启定时发布", "warning");
          return;
        }
      }

      // 3. 保存投稿数据
      try {
        const savePayload = {
          task_id: sub.task_id,
          title: elements.submissionTitle.value.trim() || sub.title,
          source_import_id: sub.source_import_id,
          sets: sub.sets,
          pixiv: sub.pixiv,
          revision: sub.task_id ? sub.revision : null,
          scheduled_at: sub.scheduled_at,
        };
        let saveRes;
        if (sub.task_id) {
          saveRes = await fetch(`/api/submissions/${encodeURIComponent(sub.task_id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(savePayload),
          });
        } else {
          saveRes = await fetch("/api/submissions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(savePayload),
          });
        }
        if (saveRes.ok) {
          const savedData = await saveRes.json();
          sub.task_id = savedData.task_id;
          sub.revision = savedData.revision;
        }
      } catch (err) {
        console.warn("保存投稿数据失败", err);
      }
    }

    const allowDelay = Boolean(elements.scheduleAllowDelayCheckbox?.checked);
    const maxDelayMinutes = parseInt(elements.scheduleDelayMinutesInput?.value, 10) || 240;

    if (elements.schedulePixivBtn) {
      elements.schedulePixivBtn.disabled = true;
    }
    try {
      const res = await fetch(`/api/submissions/${encodeURIComponent(sub.task_id)}/schedule-publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enable: enabling,
          scheduled_at: sub.scheduled_at,
          allow_delay: allowDelay,
          max_delay_minutes: maxDelayMinutes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = data.detail || {};
        const msg = detail.message || (typeof data.detail === "string" ? data.detail : "操作失败");
        throw new Error(msg);
      }

      sub.scheduled_publish = data.scheduled_publish;
      sub.allow_delay = data.allow_delay;
      sub.max_delay_minutes = data.max_delay_minutes;
      renderPixivMetadataUI();
      showNotice(data.message || (enabling ? "已开启定时发布" : "已取消定时发布"), "info");
    } catch (err) {
      showNotice(`定时发布设置失败: ${err.message}`, "error");
    } finally {
      if (elements.schedulePixivBtn) {
        elements.schedulePixivBtn.disabled = false;
      }
    }
  }

  if (elements.publishToPixivBtn) {
    elements.publishToPixivBtn.addEventListener("click", () => handlePublishToPixiv(false));
  }
  if (elements.republishToPixivBtn) {
    elements.republishToPixivBtn.addEventListener("click", () => handlePublishToPixiv(true));
  }
  if (elements.schedulePixivBtn) {
    elements.schedulePixivBtn.addEventListener("click", handleToggleSchedulePublish);
  }

  elements.newSubmissionBtn.addEventListener("click", () => {
    resetSubmissionEditor();
  });

  elements.historySubmissionSelect.addEventListener("change", (e) => {
    if (e.target.value) {
      loadSubmissionDetail(e.target.value);
    }
  });

  elements.submissionForm.addEventListener("submit", handleSubmissionSubmit);
  if (elements.deleteSubmissionBtn) {
    elements.deleteSubmissionBtn.addEventListener("click", handleDeleteSubmission);
  }

  elements.startExportBtn.addEventListener("click", handleStartExport);
  elements.openExportDirBtn.addEventListener("click", handleOpenExportDir);

  // 恢复保存的导出马赛克强度参数 (默认 10px)
  const savedMosaicSize = localStorage.getItem("export_mosaic_pixel_size") || "10";
  if (elements.exportMosaicPixelSize && elements.exportMosaicPixelVal) {
    elements.exportMosaicPixelSize.value = savedMosaicSize;
    elements.exportMosaicPixelVal.textContent = `${savedMosaicSize}px`;
    elements.exportMosaicPixelSize.addEventListener("input", (e) => {
      const val = e.target.value;
      elements.exportMosaicPixelVal.textContent = `${val}px`;
    });
    elements.exportMosaicPixelSize.addEventListener("change", (e) => {
      localStorage.setItem("export_mosaic_pixel_size", e.target.value);
    });
  }

  if (elements.exportMosaicToggle && elements.exportMosaicParams) {
    elements.exportMosaicToggle.addEventListener("change", (e) => {
      if (e.target.checked) {
        elements.exportMosaicParams.classList.remove("hidden");
      } else {
        elements.exportMosaicParams.classList.add("hidden");
      }
    });
  }

  if (elements.exportTabsContainer) {
    elements.exportTabsContainer.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-export-tab]");
      if (!btn) return;
      elements.exportTabsContainer.querySelectorAll("[data-export-tab]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.currentExportTab = btn.dataset.exportTab;
      renderExportedThumbsGrid();
    });
  }

  elements.refreshAllBtn.addEventListener("click", () => {
    snapshotCache.clear();
    loadImportsList();
    loadFacets();
    loadHistoricalSubmissions();
    switchSnapshot(state.filters.import_ids || []);
  });

  // Pro Lightbox 事件绑定
  initMosaicEditor();
  initInpaintEditor();
  if (elements.lightboxModeTabs) {
    elements.lightboxModeTabs.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-lb-tab]");
      if (!btn) return;
      switchLightboxMode(btn.dataset.lbTab);
    });
  }

  if (elements.lightboxBackBtn) {
    elements.lightboxBackBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      popLightboxHistory();
    });
  }

  if (elements.closePreview) {
    elements.closePreview.addEventListener("click", () => {
      elements.previewDialog.close();
    });
  }

  if (elements.previewDialog) {
    elements.previewDialog.addEventListener("close", () => {
      if (activePeekCleanup) activePeekCleanup();
      state.lightbox.history = [];
      updateLightboxBackButton();
      if (elements.lbHoverPreviewPopover) {
        elements.lbHoverPreviewPopover.classList.add("hidden");
      }
      if (inpaintEditor.batches && inpaintEditor.batches.length > 0) {
        handleInpaintDiscard();
      }
      inpaintEditor.currentAssetId = null;
      inpaintEditor.loaded = false;
      switchLightboxMode("view");
    });
  }

  if (elements.lightboxPrevBtn) {
    elements.lightboxPrevBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigateLightbox(-1);
    });
  }

  if (elements.lightboxNextBtn) {
    elements.lightboxNextBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigateLightbox(1);
    });
  }

  // 键盘全局快捷键与大图/瀑布流导航
  document.addEventListener("keydown", (e) => {
    // 1. 若在大图弹窗中
    if (elements.previewDialog && elements.previewDialog.open) {
      const isInput = document.activeElement && (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA" || document.activeElement.isContentEditable);
      if (!isInput && (e.key === "Backspace" || (e.altKey && e.key === "ArrowLeft"))) {
        if (state.lightbox.history && state.lightbox.history.length > 0) {
          e.preventDefault();
          popLightboxHistory();
          return;
        }
      }
      if (!isInput && e.key === "ArrowLeft") {
        e.preventDefault();
        navigateLightbox(-1);
      } else if (!isInput && e.key === "ArrowRight") {
        e.preventDefault();
        navigateLightbox(1);
      }
      return;
    }

    // 2. 若正在输入框中打字，忽略全局快捷键
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.isContentEditable)) {
      return;
    }

    // 3. 瀑布流 Ctrl+A 全选
    if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
      e.preventDefault();
      selectAllVisible();
      return;
    }

    // 4. Esc 退出多选 / 取消聚焦
    if (e.key === "Escape") {
      if (state.selectedAssetIds.size > 0) {
        e.preventDefault();
        clearAllAssetSelection();
      } else if (state.focusedAssetId) {
        e.preventDefault();
        clearCardFocus();
      }
      return;
    }

    // 5. Space 或 Enter 打开当前聚焦卡片的大图
    if (e.key === " " || e.key === "Enter") {
      if (state.focusedAssetId) {
        e.preventDefault();
        openLightbox(state.focusedAssetId);
      }
      return;
    }

    // 6. 方向键在瀑布流网格中移动焦点
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      navigateWaterfallFocus(e.key);
    }
  });

  // 批量管理模式切换按钮
  if (elements.btnBatchToggle) {
    elements.btnBatchToggle.addEventListener("click", () => {
      toggleBatchMode();
    });
  }

  // 底部悬浮批量操作栏动作绑定
  if (elements.batchBtnFav) {
    elements.batchBtnFav.addEventListener("click", () => handleBatchAction("favorite"));
  }
  if (elements.batchBtnUnfav) {
    elements.batchBtnUnfav.addEventListener("click", () => handleBatchAction("unfavorite"));
  }
  if (elements.batchBtnPost) {
    elements.batchBtnPost.addEventListener("click", () => handleBatchAction("mark_posted"));
  }
  if (elements.batchBtnUnpost) {
    elements.batchBtnUnpost.addEventListener("click", () => handleBatchAction("unmark_posted"));
  }
  if (elements.batchBtnTag) {
    elements.batchBtnTag.addEventListener("click", () => handleBatchTagging());
  }
  if (elements.batchBtnAddSet) {
    elements.batchBtnAddSet.addEventListener("click", () => {
      elements.addToSetBtn.click();
    });
  }
  if (elements.batchBtnCopyPaths) {
    elements.batchBtnCopyPaths.addEventListener("click", () => batchCopySelectedPaths());
  }
  if (elements.batchBtnClear) {
    elements.batchBtnClear.addEventListener("click", () => clearAllAssetSelection());
  }

  // 🖼️ 关联图片维度页签切换
  if (elements.lbRelatedTabs) {
    elements.lbRelatedTabs.addEventListener("click", (e) => {
      const btn = e.target.closest(".lb-rel-tab-btn");
      if (!btn) return;
      e.stopPropagation();
      elements.lbRelatedTabs.querySelectorAll(".lb-rel-tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const dimKey = btn.dataset.relTab;
      state.lightbox.currentRelatedActiveTab = dimKey;
      renderRelatedDimension(dimKey);
    });
  }

  // 🖼️ 关联图片展示模式切换 (网格 / 列表)
  if (elements.lbRelatedViewToggles) {
    elements.lbRelatedViewToggles.addEventListener("click", (e) => {
      const btn = e.target.closest(".lb-view-toggle-btn");
      if (!btn) return;
      e.stopPropagation();
      const view = btn.dataset.view || "grid";
      state.lightbox.relatedViewMode = view;
      localStorage.setItem("pw_related_view_mode", view);
      renderRelatedDimension(state.lightbox.currentRelatedActiveTab || "same_batch");
    });
  }

  // 点击外部关闭关联图片多快照下拉菜单
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".lb-rel-popover") && !e.target.closest('[data-action="toggle-rel-popover"]')) {
      document.querySelectorAll(".lb-rel-popover").forEach((p) => p.remove());
    }
  });

  // 收藏切换
  if (elements.lightboxFavoriteBtn) {
    elements.lightboxFavoriteBtn.addEventListener("click", () => {
      const aid = state.lightbox.activeAssetId;
      if (!aid) return;
      const nowFav = toggleFavorite(aid);
      updateLightboxButtonStates(aid, nowFav);

      // 同步卡片视图上的金星
      const card = elements.assetWaterfall.querySelector(`[data-asset-id="${aid}"]`);
      if (card) {
        const starBtn = card.querySelector(".asset-star-btn");
        if (starBtn) {
          starBtn.classList.toggle("starred", nowFav);
          starBtn.classList.remove("star-pop");
          void starBtn.offsetWidth;
          starBtn.classList.add("star-pop");
        }
      }
    });
  }

  // 投稿状态切换
  if (elements.lightboxPostedBtn) {
    elements.lightboxPostedBtn.addEventListener("click", async () => {
      const aid = state.lightbox.activeAssetId;
      if (!aid) return;
      const item = state.loadedAssets.get(aid);
      const realUsage = (item?.usage || []).filter(u => u !== "favorite");
      const currentlyPosted = realUsage.length > 0;
      const nextPosted = !currentlyPosted;

      try {
        const res = await fetch(`/api/assets/${encodeURIComponent(aid)}/toggle-posted`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ posted: nextPosted }),
        });
        if (res.ok) {
          if (item) {
            item.usage = nextPosted ? ["posted"] : [];
          }
          updateLightboxButtonStates(aid, null, nextPosted);

          // 同步更新瀑布流卡片上的角标
          const card = elements.assetWaterfall.querySelector(`[data-asset-id="${aid}"]`);
          if (card) {
            let badge = card.querySelector(".asset-usage-badge");
            if (nextPosted) {
              if (!badge) {
                const wrap = card.querySelector(".asset-thumb-wrap");
                badge = document.createElement("span");
                badge.className = "asset-usage-badge";
                badge.textContent = "已投稿";
                wrap.appendChild(badge);
              }
            } else {
              if (badge) badge.remove();
            }
          }
          showNotice(nextPosted ? "已标记为【已投稿】" : "已取消【已投稿】标记", "info");
        }
      } catch (err) {
        showNotice(`标记投稿失败: ${err.message}`, "error");
      }
    });
  }

  // 打开所在文件夹
  if (elements.lightboxRevealBtn) {
    elements.lightboxRevealBtn.addEventListener("click", async () => {
      // 1. 如果当前查看的是导出成品图
      if (state.lightbox.isExported && state.lightbox.exportItem) {
        const taskId = state.currentSubmission?.task_id || state.latestBuildData?.task_id;
        const tabName = state.lightbox.exportTabName || "all";
        const filename = state.lightbox.exportItem.filename;
        if (!taskId || !filename) {
          showNotice("无法定位导出文件", "warning");
          return;
        }
        try {
          const res = await fetch(
            `/api/submissions/${encodeURIComponent(taskId)}/build-images/${encodeURIComponent(tabName)}/${encodeURIComponent(filename)}/reveal`,
            { method: "POST" }
          );
          if (res.ok) {
            showNotice("已在资源管理器中定位导出成品文件", "info");
          } else {
            const err = await res.json().catch(() => ({}));
            showNotice(err.detail || "打开文件夹失败", "error");
          }
        } catch (err) {
          showNotice(`打开文件失败: ${err.message}`, "error");
        }
        return;
      }

      // 2. 如果当前查看的是素材库原图
      const aid = state.lightbox.activeAssetId;
      if (!aid) return;
      try {
        const res = await fetch(`/api/assets/${encodeURIComponent(aid)}/reveal`, {
          method: "POST",
        });
        if (res.ok) {
          showNotice("已在资源管理器中打开并高亮文件", "info");
        } else {
          const err = await res.json();
          showNotice(err.detail || "打开失败", "error");
        }
      } catch (err) {
        showNotice(`打开文件失败: ${err.message}`, "error");
      }
    });
  }

  // 复制路径与提示词
  if (elements.lightboxFilepath) {
    elements.lightboxFilepath.addEventListener("click", () => {
      const text = elements.lightboxFilepath.textContent;
      if (text) {
        navigator.clipboard.writeText(text);
        showNotice("已复制文件路径", "info");
      }
    });
  }

  if (elements.lbCopyPrompt) {
    elements.lbCopyPrompt.addEventListener("click", () => {
      const text = elements.lbPromptBox.textContent;
      if (text && text !== "无 Prompt 记录") {
        navigator.clipboard.writeText(text);
        showNotice("已复制 Prompt", "info");
      }
    });
  }

  if (elements.lbCopyNeg) {
    elements.lbCopyNeg.addEventListener("click", () => {
      const text = elements.lbNegativeBox.textContent;
      if (text && text !== "无 Negative 记录") {
        navigator.clipboard.writeText(text);
        showNotice("已复制 Negative Prompt", "info");
      }
    });
  }

  // 节点选择器绑定 (支持聚焦浏览、实时防抖、键盘导航)
  function bindNodePicker(role, inputEl, clearEl) {
    const picker = inputEl.closest(".node-picker");
    const optionsEl = picker.querySelector(".node-options");

    function updateClearButton() {
      if (clearEl) {
        clearEl.hidden = !inputEl.value.trim();
      }
    }

    let keyboardIndex = -1;

    async function fetchAndShowOptions(query = "") {
      try {
        let importParam = "";
        const selectedIds = state.filters.import_ids || [];
        if (selectedIds.length > 0 && !selectedIds.includes("__all__")) {
          importParam = `&import_ids=${encodeURIComponent(selectedIds.join(","))}`;
        } else if (state.filters.import_id && state.filters.import_id !== "__all__") {
          importParam = `&import_id=${encodeURIComponent(state.filters.import_id)}`;
        }
        const res = await fetch(`/api/nodes?role=${role}&q=${encodeURIComponent(query)}&limit=30${importParam}`);
        if (res.ok) {
          const data = await res.json();
          optionsEl.innerHTML = "";
          keyboardIndex = -1;
          if (data.nodes?.length) {
            const header = document.createElement("div");
            header.className = "node-options-header";
            header.textContent = query ? `匹配到 ${data.nodes.length} 个候选` : `可选 / 推荐候选 (${data.nodes.length})`;
            optionsEl.appendChild(header);

            data.nodes.forEach((n, idx) => {
              const val = n.name || n.value || "";
              const optBtn = document.createElement("button");
              optBtn.type = "button";
              optBtn.className = "node-option";
              optBtn.dataset.index = idx;
              optBtn.innerHTML = `<strong>${escapeHtml(val)}</strong><span class="node-option-ref">${escapeHtml(n.ref || "")}</span>`;
              optBtn.addEventListener("click", () => {
                inputEl.value = val;
                state.filters[role] = val;
                updateClearButton();
                optionsEl.classList.remove("open");
                applyInstantFilters();
              });
              optionsEl.appendChild(optBtn);
            });
            optionsEl.classList.add("open");
          } else {
            optionsEl.innerHTML = '<div class="node-options-empty">无匹配节点（回车应用自由文本）</div>';
            optionsEl.classList.add("open");
          }
        }
      } catch (err) {
        console.warn("节点搜索失败", err);
      }
    }

    // 聚焦或点击时直接弹出候选项列表
    inputEl.addEventListener("focus", () => {
      fetchAndShowOptions(inputEl.value.trim());
    });
    inputEl.addEventListener("click", () => {
      if (!optionsEl.classList.contains("open")) {
        fetchAndShowOptions(inputEl.value.trim());
      }
    });

    let timer = null;
    inputEl.addEventListener("input", () => {
      updateClearButton();
      const query = inputEl.value.trim();
      state.filters[role] = query;
      applyInstantFilters();

      clearTimeout(timer);
      timer = setTimeout(() => {
        fetchAndShowOptions(query);
      }, 120);
    });

    inputEl.addEventListener("keydown", (e) => {
      const items = optionsEl.querySelectorAll(".node-option");
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (!optionsEl.classList.contains("open")) {
          fetchAndShowOptions(inputEl.value.trim());
          return;
        }
        if (items.length) {
          keyboardIndex = (keyboardIndex + 1) % items.length;
          items.forEach((item, idx) => {
            item.classList.toggle("keyboard-active", idx === keyboardIndex);
          });
          items[keyboardIndex]?.scrollIntoView({ block: "nearest" });
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (items.length) {
          keyboardIndex = (keyboardIndex - 1 + items.length) % items.length;
          items.forEach((item, idx) => {
            item.classList.toggle("keyboard-active", idx === keyboardIndex);
          });
          items[keyboardIndex]?.scrollIntoView({ block: "nearest" });
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (keyboardIndex >= 0 && items[keyboardIndex]) {
          items[keyboardIndex].click();
        } else {
          optionsEl.classList.remove("open");
          const query = inputEl.value.trim();
          if (state.filters[role] !== query) {
            state.filters[role] = query;
            updateClearButton();
            applyInstantFilters();
          }
        }
      } else if (e.key === "Escape") {
        optionsEl.classList.remove("open");
      }
    });

    clearEl.addEventListener("click", () => {
      inputEl.value = "";
      updateClearButton();
      optionsEl.classList.remove("open");
      if (state.filters[role] !== "") {
        state.filters[role] = "";
        applyInstantFilters();
      }
    });

    document.addEventListener("click", (e) => {
      if (!picker.contains(e.target)) {
        optionsEl.classList.remove("open");
      }
    });

    updateClearButton();
  }

  bindNodePicker("artist", elements.artistFilter, document.querySelector('[data-node-role="artist"] .node-clear'));
  bindNodePicker("character", elements.characterFilter, document.querySelector('[data-node-role="character"] .node-clear'));
  bindNodePicker("action_group", elements.groupFilter, document.querySelector('[data-node-role="action_group"] .node-clear'));
  bindNodePicker("action", elements.actionFilter, document.querySelector('[data-node-role="action"] .node-clear'));

  // 初始化加载 (优先自动恢复上次选中的快照，并按需加载历史投稿与URL参数)
  (async function initApp() {
    await Promise.all([
      loadImportsList(),
      loadTagsList(),
      loadHistoricalSubmissions(),
    ]);
    await initFromUrl();
  })();
})();

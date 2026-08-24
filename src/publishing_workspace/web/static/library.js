(function () {
  "use strict";

  const state = {
    filters: {
      import_id: "",
      text: "",
      artist: "",
      character: "",
      action_group: "",
      action: "",
      facets: {},
      favorite_mode: "all", // "all" | "favorited" | "unfavorited"
      posted_mode: "all",   // "all" | "posted" | "unposted"
    },
    offset: 0,
    limit: 60,
    hasMore: true,
    loadingPage: false,
    requestToken: 0,
    loadedAssets: new Map(),
    selectedAssetIds: new Set(),
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
    facetAccordion: document.getElementById("facet-accordion"),
    clearFacetsBtn: document.getElementById("clear-facets-btn"),

    assetCountBadge: document.getElementById("asset-count-badge"),
    selectedCountBadge: document.getElementById("selected-count-badge"),
    selectAllVisibleBtn: document.getElementById("select-all-visible-btn"),
    clearSelectionBtn: document.getElementById("clear-selection-btn"),
    addToSetBtn: document.getElementById("add-to-set-btn"),
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
    pixivPublishStatusBox: document.getElementById("pixiv-publish-status-box"),

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

    lbFacetsSection: document.getElementById("lb-facets-section"),
    lbFacetsList: document.getElementById("lb-facets-list"),

    lbPromptBox: document.getElementById("lb-prompt-box"),
    lbCopyPrompt: document.getElementById("lb-copy-prompt"),
    lbNegativeBox: document.getElementById("lb-negative-box"),
    lbCopyNeg: document.getElementById("lb-copy-neg"),
    lbRawParameters: document.getElementById("lb-raw-parameters"),
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

  function getFavoritesSet(importId) {
    if (!importId) return new Set();
    if (importId === "__all__") {
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
    try {
      const raw = localStorage.getItem(FAVORITES_KEY_PREFIX + importId);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  }

  function saveFavoritesSet(importId, favSet) {
    if (!importId) return;
    const key = importId === "__all__" ? `${FAVORITES_KEY_PREFIX}global` : FAVORITES_KEY_PREFIX + importId;
    localStorage.setItem(key, JSON.stringify([...favSet]));
  }

  async function syncFavoritesFromServer(importId) {
    if (!importId) return;
    try {
      const url = importId === "__all__" ? "/api/favorites" : `/api/favorites?import_id=${encodeURIComponent(importId)}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.favorites) && data.favorites.length > 0) {
          const favSet = getFavoritesSet(importId);
          let changed = false;
          for (const id of data.favorites) {
            if (!favSet.has(id)) {
              favSet.add(id);
              changed = true;
            }
          }
          if (changed) {
            saveFavoritesSet(importId, favSet);
          }
        }
      }
    } catch {}
  }

  function isAssetFavorited(assetId) {
    return getFavoritesSet(state.filters.import_id).has(assetId);
  }

  function toggleFavorite(assetId) {
    const importId = state.filters.import_id;
    if (!importId) return false;
    const favSet = getFavoritesSet(importId);
    const nowFav = !favSet.has(assetId);
    if (nowFav) {
      favSet.add(assetId);
    } else {
      favSet.delete(assetId);
    }
    saveFavoritesSet(importId, favSet);

    // 异步同步至 Catalog 持久化
    fetch("/api/favorites/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ asset_id: assetId, import_id: importId, favorited: nowFav }),
    }).catch(() => {});

    return nowFav;
  }

  // ================= 快照独立筛选记忆与持久化 =================

  const SNAPSHOT_FILTERS_KEY_PREFIX = "pw_snapshot_filters_";
  const LAST_SELECTED_IMPORT_KEY = "pw_last_selected_import";

  function getDefaultFilters(importId = "") {
    return {
      import_id: importId,
      text: "",
      artist: "",
      character: "",
      action_group: "",
      action: "",
      facets: {},
      favorite_mode: "all",
      posted_mode: "all",
    };
  }

  function getSnapshotFilters(importId) {
    if (!importId) return getDefaultFilters("");
    try {
      const raw = localStorage.getItem(SNAPSHOT_FILTERS_KEY_PREFIX + importId);
      if (raw) {
        const saved = JSON.parse(raw);
        return {
          ...getDefaultFilters(importId),
          ...saved,
          import_id: importId,
          facets: saved.facets || {},
        };
      }
    } catch {}
    return getDefaultFilters(importId);
  }

  function saveSnapshotFilters(importId, filters) {
    if (!importId) return;
    try {
      const toSave = {
        text: filters.text || "",
        artist: filters.artist || "",
        character: filters.character || "",
        action_group: filters.action_group || "",
        action: filters.action || "",
        facets: filters.facets || {},
        favorite_mode: filters.favorite_mode || "all",
        posted_mode: filters.posted_mode || "all",
      };
      localStorage.setItem(SNAPSHOT_FILTERS_KEY_PREFIX + importId, JSON.stringify(toSave));
    } catch {}
  }

  function syncFilterInputsFromState() {
    if (elements.textFilter) elements.textFilter.value = state.filters.text || "";
    if (elements.artistFilter) elements.artistFilter.value = state.filters.artist || "";
    if (elements.characterFilter) elements.characterFilter.value = state.filters.character || "";
    if (elements.groupFilter) elements.groupFilter.value = state.filters.action_group || "";
    if (elements.actionFilter) elements.actionFilter.value = state.filters.action || "";

    document.querySelectorAll(".node-picker").forEach((picker) => {
      const input = picker.querySelector(".field-control");
      const clearBtn = picker.querySelector(".node-clear");
      if (input && clearBtn) {
        clearBtn.hidden = !input.value.trim();
      }
    });

    syncQuickFilterButtons();
    renderFacetAccordion();
    renderActiveChips();
  }

  // ================= 导入快照与 Facet 筛选 =================

  async function loadImportsList() {
    try {
      const res = await fetch("/api/imports");
      if (res.ok) {
        const data = await res.json();
        elements.importSelect.innerHTML = `
          <option value="">-- 请选择导入快照 --</option>
          <option value="__all__">🌟 全部导入素材 (全量浏览)</option>
        `;
        for (const item of data) {
          const opt = document.createElement("option");
          opt.value = item.import_id;
          opt.textContent = `${item.import_id} (${item.source_ref})`;
          elements.importSelect.appendChild(opt);
        }

        // 默认自动恢复选中上次打开的快照
        const lastSelected = localStorage.getItem(LAST_SELECTED_IMPORT_KEY);
        let restored = false;
        if (lastSelected) {
          const matchedOpt = Array.from(elements.importSelect.options).find(
            (opt) => opt.value === lastSelected
          );
          if (matchedOpt) {
            elements.importSelect.value = lastSelected;
            await switchSnapshot(lastSelected);
            restored = true;
          }
        }
        if (!restored && !state.filters.import_id) {
          await switchSnapshot("");
        }
      }
    } catch (err) {
      console.warn("加载导入列表失败", err);
      if (!state.filters.import_id) {
        await switchSnapshot("");
      }
    }
  }

  // ================= 真正服务端驱动的按需流式瀑布流 =================

  function updateGalleryProgress(loading = false) {
    if (!elements.galleryProgressBanner) return;
    const total = state.total || 0;
    const loaded = state.loadedAssets.size;

    if (!state.filters.import_id || total === 0) {
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
    const importId = state.filters.import_id;
    if (!importId) return;

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
      if (importId !== "__all__") {
        params.set("import_id", importId);
      }
      if (state.filters.text) params.set("text", state.filters.text);
      if (state.filters.artist) params.set("artist", state.filters.artist);
      if (state.filters.character) params.set("character", state.filters.character);
      if (state.filters.action_group) params.set("action_group", state.filters.action_group);
      if (state.filters.action) params.set("action", state.filters.action);
      if (Object.keys(state.filters.facets).length > 0) {
        params.set("facets", JSON.stringify(state.filters.facets));
      }
      if (state.filters.posted_mode === "posted") {
        params.set("posted", "true");
      } else if (state.filters.posted_mode === "unposted") {
        params.set("posted", "false");
      }
      if (state.filters.favorite_mode !== "all") {
        params.set("favorite_mode", state.filters.favorite_mode);
        const favSet = getFavoritesSet(importId);
        params.set("favorite_ids", JSON.stringify([...favSet]));
      }

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

  async function switchSnapshot(importId) {
    // 1. 如果之前有选中的快照，保存旧快照的当前独立筛选
    if (state.filters.import_id && state.filters.import_id !== importId) {
      saveSnapshotFilters(state.filters.import_id, state.filters);
    }

    // 2. 记忆当前最后选中的快照
    if (importId) {
      localStorage.setItem(LAST_SELECTED_IMPORT_KEY, importId);
    } else {
      localStorage.removeItem(LAST_SELECTED_IMPORT_KEY);
    }

    // 3. 并行从服务端同步已持久化的收藏标记 (不阻塞瀑布流首屏与 Facets 加载)
    syncFavoritesFromServer(importId).then(() => {
      if (state.filters.favorite_mode !== "all") {
        applyClientFilter();
      }
    });

    // 4. 加载目标快照独立的专属筛选配置
    state.filters = getSnapshotFilters(importId);
    state.selectedAssetIds.clear();
    updateSelectionBadges();

    // 5. 同步更新所有 UI 筛选控件
    syncFilterInputsFromState();

    if (!importId) {
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

  function applyInstantFilters() {
    if (state.filters.import_id) {
      saveSnapshotFilters(state.filters.import_id, state.filters);
    }
    renderActiveChips();
    if (state.filters.import_id) {
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
      const url = (state.filters.import_id && state.filters.import_id !== "__all__")
        ? `/api/library/facets?import_id=${encodeURIComponent(state.filters.import_id)}`
        : "/api/library/facets";
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
    const orderBadgeHtml = isSelected ? `<span class="asset-order-badge">${orderIdx + 1}</span>` : "";

    card.innerHTML = `
      <div class="asset-thumb-wrap" style="aspect-ratio: ${ratio};">
        <input type="checkbox" class="asset-checkbox" ${isSelected ? "checked" : ""}>
        ${orderBadgeHtml}
        ${usageBadgeHtml}
        <button class="asset-star-btn ${isFav ? "starred" : ""}" type="button" title="收藏">★</button>
        <img class="asset-thumb" loading="lazy" src="${previewUrl}" alt="${escapeHtml(item.display_name)}">
      </div>
      <div class="asset-info">
        <div class="asset-name" title="${escapeHtml(item.display_name)}">${escapeHtml(item.display_name)}</div>
        <div class="asset-dims">${item.width || 0} × ${item.height || 0} (${item.image_format || "PNG"})</div>
      </div>
    `;

    const checkbox = card.querySelector(".asset-checkbox");
    const starBtn = card.querySelector(".asset-star-btn");

    // 收藏按钮点击
    starBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const nowFav = toggleFavorite(item.asset_id);
      starBtn.classList.toggle("starred", nowFav);
      // 弹出动画
      starBtn.classList.remove("star-pop");
      void starBtn.offsetWidth; // 强制 reflow 以重触发动画
      starBtn.classList.add("star-pop");
      // 如果正在筛选收藏状态，重新过滤
      if (state.filters.favorite_mode !== "all") {
        applyClientFilter();
      }
    });

    checkbox.addEventListener("change", (e) => {
      e.stopPropagation();
      toggleAssetSelection(item.asset_id, checkbox.checked);
    });

    // 点击缩略图或双击卡片打开大图与详情 Lightbox
    const thumbImg = card.querySelector(".asset-thumb");
    if (thumbImg) {
      thumbImg.addEventListener("click", (e) => {
        e.stopPropagation();
        openLightbox(item.asset_id);
      });
    }

    card.addEventListener("click", () => {
      const newState = !state.selectedAssetIds.has(item.asset_id);
      checkbox.checked = newState;
      toggleAssetSelection(item.asset_id, newState);
    });

    card.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      openLightbox(item.asset_id);
    });

    return card;
  }

  function toggleAssetSelection(assetId, isSelected) {
    if (isSelected) {
      if (!state.selectedAssetIds.has(assetId)) {
        state.selectedAssetIds.add(assetId);
      }
    } else {
      state.selectedAssetIds.delete(assetId);
    }
    updateSelectionBadges();
  }

  function updateSelectionBadges() {
    const selectedArr = Array.from(state.selectedAssetIds);
    elements.selectedCountBadge.textContent = `已选 ${selectedArr.length} 项`;

    // 遍历瀑布流中已渲染的卡片，同步其选中态和次序徽章
    elements.assetWaterfall.querySelectorAll(".asset-card").forEach((card) => {
      const aid = card.dataset.assetId;
      const idx = selectedArr.indexOf(aid);
      const cb = card.querySelector(".asset-checkbox");
      let orderBadge = card.querySelector(".asset-order-badge");

      if (idx !== -1) {
        card.classList.add("selected");
        if (cb) cb.checked = true;
        const orderNum = idx + 1;
        if (!orderBadge) {
          orderBadge = document.createElement("span");
          orderBadge.className = "asset-order-badge";
          const wrap = card.querySelector(".asset-thumb-wrap");
          if (wrap) wrap.appendChild(orderBadge);
        }
        orderBadge.textContent = String(orderNum);
      } else {
        card.classList.remove("selected");
        if (cb) cb.checked = false;
        if (orderBadge) orderBadge.remove();
      }
    });
  }

  function clearAllAssetSelection() {
    state.selectedAssetIds.clear();
    updateSelectionBadges();
  }

  // ================= Pro Lightbox 大图与图片详情控制器 =================

  state.lightbox = {
    activeAssetId: null,
    assetList: [],
    currentIndex: -1,
  };

  function getVisibleAssetIds() {
    const list = [];
    state.loadedAssets.forEach((item, assetId) => {
      list.push(assetId);
    });
    return list;
  }

  async function openLightbox(assetId, customAssetList = null) {
    if (Array.isArray(customAssetList) && customAssetList.length > 0) {
      state.lightbox.assetList = [...customAssetList];
    } else {
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
      elements.lightboxModeTabs.classList.add("hidden");
    }
    switchLightboxMode("view");

    // 1. 顶部 Header 状态
    elements.lightboxCounter.textContent = `${currentNum} / ${total}`;
    elements.lightboxFilename.textContent = item?.display_name || assetId;
    elements.lightboxFilepath.textContent = item?.path || "";

    // 2. 左侧大图
    elements.previewImage.src = `/api/assets/${encodeURIComponent(assetId)}/preview`;
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
    } else {
      elements.lbMetaDimensions.textContent = "-";
      elements.lbNodeArtist.textContent = "-";
      elements.lbNodeCharacter.textContent = "-";
      elements.lbNodeGroup.textContent = "-";
      elements.lbNodeAction.textContent = "-";
      elements.lbFacetsSection.hidden = true;
    }

    // 4. 按钮状态初始同步
    updateLightboxButtonStates(assetId);

    // 5. 异步获取完整 PNG 元数据
    try {
      const res = await fetch(`/api/assets/${encodeURIComponent(assetId)}/details`);
      if (res.ok && state.lightbox.activeAssetId === assetId) {
        const detail = await res.json();
        elements.lightboxFilename.textContent = detail.display_name || assetId;
        elements.lightboxFilepath.textContent = detail.path || "";
        const gen = detail.generation_info || {};
        elements.lbMetaDimensions.textContent = `${detail.width} × ${detail.height} (${detail.image_format || "PNG"})`;
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
      }
    } catch (err) {
      console.warn("获取素材详情失败", err);
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
          illust_id: null,
          published_at: null,
          last_publish_status: null,
          last_publish_error: null,
        },
        scheduled_at: data.scheduled_at || null,
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
        illust_id: null,
        published_at: null,
        last_publish_status: null,
        last_publish_error: null,
      },
      scheduled_at: null,
      currentSetTab: "all",
      legacyInlineSource: null,
    };
    state.tagSuggestions = { preset: [], character: [], action: [], pixiv: [] };
    elements.legacyConvertBanner.classList.add("hidden");
    elements.historySubmissionSelect.value = "";
    if (elements.submissionDate) elements.submissionDate.value = "";
    if (elements.submissionTime) elements.submissionTime.value = "20:00";
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
      } else {
        elements.submissionPixivBadge.classList.add("hidden");
      }
    }

    if (elements.pixivPublishStatusBox && elements.publishToPixivBtn) {
      if (pix.illust_id) {
        elements.pixivPublishStatusBox.classList.remove("hidden");
        elements.pixivPublishStatusBox.className = "pixiv-publish-status-box published";
        elements.pixivPublishStatusBox.innerHTML = `<span>✓ 已发布到 Pixiv：<a href="https://www.pixiv.net/artworks/${encodeURIComponent(pix.illust_id)}" target="_blank" class="pixiv-pid-link">PID: ${escapeHtml(pix.illust_id)} ↗</a></span><span class="helper-text" style="font-size:11px;">${pix.published_at ? escapeHtml(pix.published_at.slice(0, 19).replace("T", " ")) : ""}</span>`;
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

  async function handleSubmissionSubmit(e) {
    e.preventDefault();
    clearNotice();

    const sub = state.currentSubmission;
    const title = elements.submissionTitle.value.trim();
    if (!title) {
      showNotice("投稿标题不能为空", "warning");
      return;
    }
    if (!sub.sets.all.length) {
      showNotice("all 集合不能为空", "warning");
      return;
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
        illust_id: sub.pixiv?.illust_id || null,
        published_at: sub.pixiv?.published_at || null,
        last_publish_status: sub.pixiv?.last_publish_status || null,
        last_publish_error: sub.pixiv?.last_publish_error || null,
      },
      revision: sub.task_id ? sub.revision : null,
      scheduled_at: scheduledAt,
    };

    try {
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
      if (savedData.scheduled_at) {
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

        // 保持打码复选框默认开启
        if (elements.exportMosaicToggle) {
          elements.exportMosaicToggle.checked = true;
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

      // 刷新大图与面板缩略图
      const cacheBustUrl = `${item.preview_url.split("?")[0]}?t=${Date.now()}`;
      item.preview_url = cacheBustUrl;
      elements.previewImage.src = cacheBustUrl;
      renderExportedThumbsGrid();

      // 自动切回 view 模式
      switchLightboxMode("view");
    } catch (err) {
      showNotice(`保存编辑失败：${err.message}`, "error");
    }
  }

  function switchLightboxMode(mode) {
    state.lightbox.mode = mode;
    if (elements.lightboxModeTabs) {
      elements.lightboxModeTabs.querySelectorAll("[data-lb-tab]").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.lbTab === mode);
      });
    }

    const body = elements.lightboxContainer ? elements.lightboxContainer.querySelector(".lightbox-body") : null;

    if (mode === "edit") {
      if (body) body.classList.add("mode-edit");
      if (elements.lightboxImageArea) elements.lightboxImageArea.classList.add("hidden");
      if (elements.lightboxEditorArea) elements.lightboxEditorArea.classList.remove("hidden");

      const item = state.lightbox.exportItem;
      if (item) {
        // 延迟一帧以确保容器可见后再计算尺寸
        requestAnimationFrame(() => loadImageToMosaic(item.preview_url));
      }
    } else {
      if (body) body.classList.remove("mode-edit");
      if (elements.lightboxImageArea) elements.lightboxImageArea.classList.remove("hidden");
      if (elements.lightboxEditorArea) elements.lightboxEditorArea.classList.add("hidden");
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

    try {
      const res = await fetch(`/api/submissions/${encodeURIComponent(taskId)}/exports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enable_mosaic: enableMosaic }),
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

  elements.importSelect.addEventListener("change", (e) => {
    switchSnapshot(e.target.value);
  });

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
      favorite_mode: "all",
      posted_mode: "all",
    };
    elements.textFilter.value = "";
    elements.artistFilter.value = "";
    elements.characterFilter.value = "";
    elements.groupFilter.value = "";
    elements.actionFilter.value = "";
    document.querySelectorAll(".node-clear").forEach((btn) => (btn.hidden = true));
    syncQuickFilterButtons();
    renderFacetAccordion();
    loadAssetsPage(true);
  });

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
      const saveRes = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_id: sub.task_id,
          title: elements.submissionTitle.value.trim() || sub.title,
          source_import_id: sub.source_import_id,
          sets: sub.sets,
          pixiv: sub.pixiv,
        }),
      });
      if (!saveRes.ok) {
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
            import_id: state.filters.import_id || null,
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



  if (elements.publishToPixivBtn) {
    elements.publishToPixivBtn.addEventListener("click", () => handlePublishToPixiv(false));
  }
  if (elements.republishToPixivBtn) {
    elements.republishToPixivBtn.addEventListener("click", () => handlePublishToPixiv(true));
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
    switchSnapshot(state.filters.import_id);
  });

  // Pro Lightbox 事件绑定
  initMosaicEditor();
  if (elements.lightboxModeTabs) {
    elements.lightboxModeTabs.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-lb-tab]");
      if (!btn) return;
      switchLightboxMode(btn.dataset.lbTab);
    });
  }

  if (elements.closePreview) {
    elements.closePreview.addEventListener("click", () => {
      elements.previewDialog.close();
    });
  }

  if (elements.previewDialog) {
    elements.previewDialog.addEventListener("close", () => {
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

  // 键盘左右箭头切换大图
  document.addEventListener("keydown", (e) => {
    if (!elements.previewDialog.open) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      navigateLightbox(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      navigateLightbox(1);
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
        const importParam = state.filters.import_id ? `&import_id=${encodeURIComponent(state.filters.import_id)}` : "";
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
    await loadImportsList();
    await loadHistoricalSubmissions();
    await initFromUrl();
  })();
})();

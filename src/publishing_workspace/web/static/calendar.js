(function () {
  "use strict";

  const state = {
    month: "",
    plan: null,
    submissions: [],
    selectedEntryId: null,
    draggedEntryId: null,
    draggedUnscheduledTaskId: null,
    selectedUnscheduledTaskId: null,
    unscheduledSearchQuery: "",
    currentDetail: null,
    currentDetailTab: "all",
    currentBuildTab: "all",
    taskDetailsCache: new Map(),
    lightbox: {
      items: [],
      index: 0,
      setName: "all",
      isBuild: false,
    },
  };

  const elements = {
    monthPicker: document.getElementById("month-picker"),
    prevMonth: document.getElementById("previous-month"),
    nextMonth: document.getElementById("next-month"),
    planStatus: document.getElementById("plan-status"),
    notice: document.getElementById("notice"),
    unscheduledList: document.getElementById("unscheduled-list"),
    unscheduledCountBadge: document.getElementById("unscheduled-count-badge"),
    unscheduledSearchInput: document.getElementById("unscheduled-search-input"),
    refreshUnscheduledBtn: document.getElementById("refresh-unscheduled-btn"),
    calendarTitle: document.getElementById("calendar-title"),
    calendarSubtitle: document.getElementById("calendar-subtitle"),
    calendarGrid: document.getElementById("calendar-grid"),
    newEntryBtn: document.getElementById("new-entry"),
    editorTitle: document.getElementById("editor-title"),
    resetEditorBtn: document.getElementById("reset-editor"),
    entryForm: document.getElementById("entry-form"),
    entryId: document.getElementById("entry-id"),
    entryTitle: document.getElementById("entry-title"),
    entryDate: document.getElementById("entry-date"),
    entryTime: document.getElementById("entry-time"),
    taskSelect: document.getElementById("task-select"),
    legacyNotice: document.getElementById("legacy-notice"),
    convertLegacyLink: document.getElementById("convert-legacy-link"),
    taskLinkBox: document.getElementById("task-link-box"),
    gotoLibraryLink: document.getElementById("goto-library-link"),
    entryPublishCheckbox: document.getElementById("entry-publish-checkbox"),
    entryDelayOptionsRow: document.getElementById("entry-delay-options-row"),
    entryAllowDelayCheckbox: document.getElementById("entry-allow-delay-checkbox"),
    entryDelayMinutesInput: document.getElementById("entry-delay-minutes-input"),
    saveEntryBtn: document.getElementById("save-entry"),
    deleteEntryBtn: document.getElementById("delete-entry"),

    // 投稿详情卡片
    detailCard: document.getElementById("submission-detail-card"),
    detailTitle: document.getElementById("detail-task-title"),
    detailTaskId: document.getElementById("detail-task-id"),
    detailExportStatus: document.getElementById("detail-export-status"),
    detailPixivStatus: document.getElementById("detail-pixiv-status"),
    detailPixivBox: document.getElementById("detail-pixiv-schedule-box"),
    detailPublishToPixivBtn: document.getElementById("detail-publish-to-pixiv-btn"),
    detailSchedulePixivBtn: document.getElementById("detail-schedule-pixiv-btn"),
    detailScheduleAllowDelayCheckbox: document.getElementById("detail-schedule-allow-delay-checkbox"),
    detailScheduleDelayMinutesInput: document.getElementById("detail-schedule-delay-minutes-input"),
    detailPixivScheduleStatus: document.getElementById("detail-pixiv-schedule-status"),
    detailOpenLibraryBtn: document.getElementById("detail-open-library-btn"),
    detailDeleteSubmissionBtn: document.getElementById("detail-delete-submission-btn"),
    detailCountAll: document.getElementById("detail-count-all"),
    detailCountPost: document.getElementById("detail-count-post"),
    detailCountCover: document.getElementById("detail-count-cover"),
    detailThumbsContainer: document.getElementById("detail-thumbs-container"),

    // 导出成品区域
    detailBuildSection: document.getElementById("detail-build-section"),
    detailBuildTime: document.getElementById("detail-build-time"),
    detailNoBuildBox: document.getElementById("detail-no-build-box"),
    detailBuildCountAll: document.getElementById("detail-build-count-all"),
    detailBuildCountPost: document.getElementById("detail-build-count-post"),
    detailBuildCountCover: document.getElementById("detail-build-count-cover"),
    detailBuildThumbsContainer: document.getElementById("detail-build-thumbs-container"),
    detailExportDownloads: document.getElementById("detail-export-downloads"),
    detailOpenBuildDirBtn: document.getElementById("detail-open-build-dir-btn"),

    // Lightbox Modal
    previewDialog: document.getElementById("preview-dialog"),
    previewImage: document.getElementById("preview-image"),
    lightboxCounter: document.getElementById("lightbox-counter"),
    lightboxCaption: document.getElementById("lightbox-caption"),
    lightboxRevealBtn: document.getElementById("lightbox-reveal-btn"),
    lightboxPrev: document.getElementById("lightbox-prev"),
    lightboxNext: document.getElementById("lightbox-next"),
    closePreview: document.getElementById("close-preview"),
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

  function getQueryMonth() {
    const params = new URLSearchParams(window.location.search);
    const month = params.get("month");
    if (month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return month;
    }
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }

  function shiftMonth(monthStr, offset) {
    const [yStr, mStr] = monthStr.split("-");
    let y = parseInt(yStr, 10);
    let m = parseInt(mStr, 10) + offset;
    while (m > 12) {
      m -= 12;
      y += 1;
    }
    while (m < 1) {
      m += 12;
      y -= 1;
    }
    return `${y}-${String(m).padStart(2, "0")}`;
  }

  async function loadSubmissionsList() {
    try {
      const res = await fetch("/api/submissions");
      if (res.ok) {
        state.submissions = await res.json();
        updateTaskOptions();
        renderCalendarGrid();
        renderUnscheduledList();
      }
    } catch (err) {
      console.warn("加载投稿列表失败", err);
    }
  }

  function updateTaskOptions() {
    const currentVal = elements.taskSelect.value;
    elements.taskSelect.innerHTML = '<option value="">-- 选择已有投稿任务 --</option>';
    for (const sub of state.submissions) {
      const opt = document.createElement("option");
      opt.value = sub.task_id;
      const count = sub.counts && typeof sub.counts.all === "number" ? ` (${sub.counts.all}图)` : "";
      opt.textContent = `${sub.title || sub.task_id}${count}`;
      elements.taskSelect.appendChild(opt);
    }
    if (currentVal) {
      elements.taskSelect.value = currentVal;
    }
  }

  async function loadPlan(month) {
    state.month = month;
    elements.monthPicker.value = month;
    elements.calendarTitle.textContent = `${month} 投稿排期`;
    elements.newEntryBtn.disabled = true;
    clearNotice();

    try {
      const res = await fetch(`/api/plans/${month}`);
      if (!res.ok) {
        throw new Error(`加载计划失败 (${res.status})`);
      }
      state.plan = await res.json();
      if (Array.isArray(state.plan.entries)) {
        state.plan.entries.sort((a, b) => (a.scheduled_at || "").localeCompare(b.scheduled_at || ""));
      }
      elements.calendarSubtitle.textContent = state.plan.timezone || "Asia/Shanghai";
      elements.planStatus.textContent = state.plan.status === "locked" ? "已锁定" : "草稿";
      elements.planStatus.className = `status-badge ${state.plan.status === "locked" ? "locked" : ""}`;
      elements.newEntryBtn.disabled = state.plan.status === "locked";
      renderCalendarGrid();
      renderUnscheduledList();
      resetEditor();
    } catch (err) {
      showNotice(err.message, "error");
    }
  }

  function renderCalendarGrid() {
    elements.calendarGrid.innerHTML = "";
    if (!state.plan) return;

    const [yearStr, monthStr] = state.month.split("-");
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);

    const firstDay = new Date(year, month - 1, 1);
    let startDayOfWeek = firstDay.getDay() - 1; // 0 = Monday
    if (startDayOfWeek === -1) startDayOfWeek = 6; // Sunday

    const daysInMonth = new Date(year, month, 0).getDate();
    const daysInPrevMonth = new Date(year, month - 1, 0).getDate();

    const todayStr = new Date().toISOString().slice(0, 10);

    // 填充上月末尾几天
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const cell = document.createElement("div");
      cell.className = "calendar-cell other-month";
      const dayNum = daysInPrevMonth - i;
      cell.innerHTML = `<div class="cell-header"><span class="cell-day">${dayNum}</span></div>`;
      elements.calendarGrid.appendChild(cell);
    }

    // 填充当月每天
    for (let day = 1; day <= daysInMonth; day++) {
      const dayStr = String(day).padStart(2, "0");
      const dateStr = `${state.month}-${dayStr}`;
      const cell = document.createElement("div");
      cell.className = "calendar-cell";
      const dayOfWeek = (startDayOfWeek + day - 1) % 7;
      if (dayOfWeek === 5 || dayOfWeek === 6) {
        cell.classList.add("weekend-cell");
      }
      if (dateStr === todayStr) {
        cell.classList.add("today");
      }
      cell.dataset.date = dateStr;

      cell.innerHTML = `<div class="cell-header"><span class="cell-day">${day}</span></div><div class="cell-entries"></div>`;

      // 拖拽目的地事件
      cell.addEventListener("dragover", (e) => {
        if ((state.draggedEntryId || state.draggedUnscheduledTaskId) && state.plan?.status !== "locked") {
          e.preventDefault();
          cell.classList.add("drag-over");
        }
      });
      cell.addEventListener("dragleave", () => {
        cell.classList.remove("drag-over");
      });
      cell.addEventListener("drop", async (e) => {
        e.preventDefault();
        cell.classList.remove("drag-over");
        if (!state.plan || state.plan.status === "locked") return;

        if (state.draggedEntryId) {
          handleEntryMove(state.draggedEntryId, dateStr);
        } else if (state.draggedUnscheduledTaskId) {
          await handleScheduleUnscheduledTask(state.draggedUnscheduledTaskId, dateStr);
        }
      });

      // 双击单元格新建排期
      cell.addEventListener("dblclick", () => {
        if (state.plan.status !== "locked") {
          openNewEntryForDate(dateStr);
        }
      });

      const entriesContainer = cell.querySelector(".cell-entries");
      const dayEntries = (state.plan.entries || [])
        .filter((e) => e.scheduled_at && e.scheduled_at.startsWith(dateStr))
        .sort((a, b) => (a.scheduled_at || "").localeCompare(b.scheduled_at || ""));

      for (const entry of dayEntries) {
        const card = createEntryCard(entry);
        entriesContainer.appendChild(card);
      }

      elements.calendarGrid.appendChild(cell);
    }

    // 填充下月初几天补齐整周 (7的倍数)
    const totalRendered = startDayOfWeek + daysInMonth;
    const remainingCells = (7 - (totalRendered % 7)) % 7;
    for (let i = 1; i <= remainingCells; i++) {
      const cell = document.createElement("div");
      cell.className = "calendar-cell other-month";
      cell.innerHTML = `<div class="cell-header"><span class="cell-day">${i}</span></div>`;
      elements.calendarGrid.appendChild(cell);
    }
  }

  function createEntryCard(entry) {
    const card = document.createElement("div");
    card.className = "entry-card";
    if (state.selectedEntryId === entry.entry_id) {
      card.classList.add("selected");
    }
    card.draggable = state.plan.status !== "locked";

    const isTask = entry.content && entry.content.kind === "task";
    const isInline = entry.content && entry.content.kind === "inline_selection";

    let countText = "";
    let pixivBadge = "";

    if (isTask) {
      const sub = state.submissions.find((s) => s.task_id === entry.content.task_id);
      if (sub && sub.counts) {
        countText = `${sub.counts.all || sub.counts.post || 0}图`;
      }
      if (sub && sub.pixiv && sub.pixiv.illust_id) {
        card.classList.add("is-published");
        const pubTimeTooltip = sub.pixiv.published_at ? `\n实际发布时间: ${formatPublishedAt(sub.pixiv.published_at)}` : "";
        pixivBadge = `<span class="entry-badge pixiv-published" title="已发布到 Pixiv (PID: ${sub.pixiv.illust_id})${pubTimeTooltip}">✓ Pixiv</span>`;
      } else if (entry.execution && entry.execution.publish) {
        card.classList.add("is-scheduled");
        pixivBadge = `<span class="entry-badge pixiv-scheduled" title="已开启定时自动发布 Pixiv">⏰ 定时</span>`;
      } else {
        card.classList.add("is-draft");
      }
    } else if (isInline && entry.content.sets) {
      card.classList.add("is-legacy");
      if (entry.execution && entry.execution.publish) {
        pixivBadge = `<span class="entry-badge pixiv-scheduled" title="已开启定时自动发布 Pixiv">⏰ 定时</span>`;
      }
      const allLen = (entry.content.sets.all || entry.content.sets.post || []).length;
      countText = `${allLen}图`;
    }

    let timeStr = "";
    if (entry.scheduled_at) {
      const match = entry.scheduled_at.match(/T(\d{2}:\d{2})/);
      if (match) timeStr = match[1];
    }

    const metaBadges = [];
    if (timeStr) {
      metaBadges.push(`<span class="entry-card-time">${timeStr}</span>`);
    }
    if (isInline) {
      metaBadges.push(`<span class="entry-badge legacy">散图</span>`);
    }
    if (countText) {
      metaBadges.push(`<span class="entry-count-tag">${countText}</span>`);
    }
    if (pixivBadge) {
      metaBadges.push(pixivBadge);
    }

    card.innerHTML = `
      <div class="entry-card-info">
        <div class="entry-card-title" title="${escapeHtml(entry.title)}">${escapeHtml(entry.title)}</div>
        <div class="entry-card-meta">
          ${metaBadges.join("")}
        </div>
      </div>
    `;

    card.addEventListener("dragstart", (e) => {
      state.draggedEntryId = entry.entry_id;
      e.dataTransfer.setData("text/plain", entry.entry_id);
    });
    card.addEventListener("dragend", () => {
      state.draggedEntryId = null;
    });

    card.addEventListener("click", (e) => {
      e.stopPropagation();
      selectEntry(entry);
    });

    return card;
  }

  function escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function handleEntryMove(entryId, targetDate) {
    if (!state.plan) return;
    clearNotice();

    try {
      const res = await fetch(`/api/plans/${state.month}/entries/${entryId}/date`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision: state.plan.revision,
          target_date: targetDate,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail?.message || `移动日期失败 (${res.status})`);
      }
      state.plan = await res.json();
      showNotice(`已将排期移动至 ${targetDate}`, "info");
      renderCalendarGrid();
      if (state.selectedEntryId === entryId) {
        const updated = (state.plan.entries || []).find((e) => e.entry_id === entryId);
        if (updated) selectEntry(updated);
      }
    } catch (err) {
      showNotice(err.message, "error");
    }
  }

  async function handleScheduleUnscheduledTask(taskId, dateStr) {
    const sub = state.submissions.find((s) => s.task_id === taskId);
    if (!sub || !state.plan || state.plan.status === "locked") return;

    const targetEntryId = `entry-${taskId}`;
    const scheduledAt = `${dateStr}T20:00:00+08:00`;
    const payload = {
      revision: state.plan.revision,
      entry: {
        entry_id: targetEntryId,
        scheduled_at: scheduledAt,
        title: sub.title || taskId,
        content: { kind: "task", task_id: taskId },
        execution: { build_on_due: true, notify_on_complete: true, publish: false },
      },
    };

    try {
      const res = await fetch(`/api/plans/${state.month}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail?.message || data.detail || `排期失败 (${res.status})`);
      }
      showNotice(`🎉 已成功将【${sub.title || taskId}】安排在 ${dateStr} 20:00`, "info");
      await loadPlan(state.month);
      await loadSubmissionsList();
    } catch (err) {
      showNotice(`排期失败: ${err.message}`, "error");
    } finally {
      state.draggedUnscheduledTaskId = null;
    }
  }

  function renderUnscheduledList() {
    if (!elements.unscheduledList) return;
    const query = (state.unscheduledSearchQuery || "").trim().toLowerCase();

    // 过滤出未排期的投稿（没有 scheduled_entries 或者 scheduled_entries 为空）
    const unscheduled = (state.submissions || []).filter((sub) => {
      const isUnscheduled = !sub.scheduled_entries || sub.scheduled_entries.length === 0;
      if (!isUnscheduled) return false;
      if (!query) return true;
      const titleMatch = (sub.title || "").toLowerCase().includes(query);
      const idMatch = (sub.task_id || "").toLowerCase().includes(query);
      return titleMatch || idMatch;
    });

    if (elements.unscheduledCountBadge) {
      elements.unscheduledCountBadge.textContent = String(unscheduled.length);
    }

    elements.unscheduledList.innerHTML = "";
    if (unscheduled.length === 0) {
      elements.unscheduledList.innerHTML = `
        <div class="unscheduled-empty">
          ${query ? "未找到匹配的待排期投稿" : "🎉 所有投稿均已安排排期"}
        </div>
      `;
      return;
    }

    for (const sub of unscheduled) {
      const card = document.createElement("div");
      card.className = `unscheduled-card ${state.selectedUnscheduledTaskId === sub.task_id ? "active" : ""}`;
      card.draggable = state.plan?.status !== "locked";
      card.dataset.taskId = sub.task_id;

      const count = sub.counts && typeof sub.counts.all === "number" ? `${sub.counts.all}图` : "";
      let pixivBadgeHtml = "";
      if (sub.pixiv?.illust_id) {
        pixivBadgeHtml = `<span class="unscheduled-tag pixiv" title="PID: ${sub.pixiv.illust_id}">✓ Pixiv</span>`;
      } else {
        pixivBadgeHtml = `<span class="unscheduled-tag unpub">未发布</span>`;
      }

      card.innerHTML = `
        <div class="unscheduled-card-header">
          <div class="unscheduled-card-title" title="${escapeHtml(sub.title || sub.task_id)}">
            ${escapeHtml(sub.title || sub.task_id)}
          </div>
          <div class="unscheduled-card-actions">
            <button class="unscheduled-assign-btn" type="button" title="载入排期表单">排期 &rarr;</button>
          </div>
        </div>
        <div class="unscheduled-card-meta">
          <span class="unscheduled-tag count">${count || "0图"}</span>
          ${pixivBadgeHtml}
          <span class="unscheduled-tag unpub">未排期</span>
        </div>
        <div class="unscheduled-drag-hint">
          <span>🖐️ 拖拽至右侧日历快速排期</span>
        </div>
      `;

      // 拖拽事件
      card.addEventListener("dragstart", (e) => {
        if (state.plan?.status === "locked") return;
        state.draggedUnscheduledTaskId = sub.task_id;
        state.draggedEntryId = null;
        card.classList.add("dragging");
        e.dataTransfer.effectAllowed = "copyMove";
        e.dataTransfer.setData("text/plain", JSON.stringify({ type: "unscheduled_task", taskId: sub.task_id }));
      });

      card.addEventListener("dragend", () => {
        card.classList.remove("dragging");
        state.draggedUnscheduledTaskId = null;
      });

      // 点击卡片：选中并载入排期表单与预览
      card.addEventListener("click", () => {
        selectUnscheduledForScheduling(sub);
      });

      elements.unscheduledList.appendChild(card);
    }
  }

  function selectUnscheduledForScheduling(sub) {
    state.selectedUnscheduledTaskId = sub.task_id;
    state.selectedEntryId = null;

    elements.editorTitle.textContent = "新建排期 (关联投稿)";
    elements.entryId.value = "";
    elements.entryTitle.value = sub.title || sub.task_id;
    elements.taskSelect.value = sub.task_id;
    if (!elements.entryDate.value) {
      elements.entryDate.value = `${state.month}-01`;
    }
    elements.legacyNotice.classList.add("hidden");
    elements.taskLinkBox.classList.remove("hidden");
    elements.gotoLibraryLink.href = `/library?submission_id=${encodeURIComponent(sub.task_id)}`;
    elements.saveEntryBtn.disabled = !state.plan || state.plan.status === "locked";
    elements.deleteEntryBtn.disabled = true;

    renderCalendarGrid();
    renderUnscheduledList();
    loadAndDisplayTaskDetail(sub.task_id, sub.title);
  }

  function selectEntry(entry) {
    state.selectedEntryId = entry.entry_id;
    state.selectedUnscheduledTaskId = null;
    elements.editorTitle.textContent = "编辑排期";
    elements.entryId.value = entry.entry_id;
    elements.entryTitle.value = entry.title || "";

    if (entry.scheduled_at) {
      elements.entryDate.value = entry.scheduled_at.slice(0, 10);
      const timeMatch = entry.scheduled_at.match(/T(\d{2}:\d{2})/);
      if (timeMatch) elements.entryTime.value = timeMatch[1];
    }

    const isPub = Boolean(entry.execution?.publish);
    if (elements.entryPublishCheckbox) elements.entryPublishCheckbox.checked = isPub;
    if (elements.entryAllowDelayCheckbox) elements.entryAllowDelayCheckbox.checked = Boolean(entry.execution?.allow_delay);
    if (elements.entryDelayMinutesInput) {
      elements.entryDelayMinutesInput.value = entry.execution?.allow_delay ? (entry.execution?.max_delay_minutes || 240) : 240;
    }
    if (elements.entryDelayOptionsRow) elements.entryDelayOptionsRow.classList.toggle("hidden", !isPub);

    const isTask = entry.content && entry.content.kind === "task";
    const isInline = entry.content && entry.content.kind === "inline_selection";

    if (isTask) {
      elements.taskSelect.value = entry.content.task_id || "";
      elements.legacyNotice.classList.add("hidden");
      elements.taskLinkBox.classList.remove("hidden");
      elements.gotoLibraryLink.href = `/library?submission_id=${encodeURIComponent(entry.content.task_id)}`;
      loadAndDisplayTaskDetail(entry.content.task_id, entry.title);
    } else if (isInline) {
      elements.taskSelect.value = "";
      elements.legacyNotice.classList.remove("hidden");
      elements.convertLegacyLink.href = `/library?plan_id=${encodeURIComponent(state.month)}&entry_id=${encodeURIComponent(entry.entry_id)}`;
      elements.taskLinkBox.classList.add("hidden");
      displayInlineDetail(entry);
    } else {
      elements.taskSelect.value = "";
      elements.legacyNotice.classList.add("hidden");
      elements.taskLinkBox.classList.add("hidden");
      hideTaskDetail();
    }

    elements.saveEntryBtn.disabled = state.plan.status === "locked";
    elements.deleteEntryBtn.disabled = state.plan.status === "locked";

    renderCalendarGrid();
    renderUnscheduledList();
  }

  function openNewEntryForDate(dateStr) {
    resetEditor();
    elements.entryDate.value = dateStr || `${state.month}-01`;
  }

  function resetEditor() {
    state.selectedEntryId = null;
    state.selectedUnscheduledTaskId = null;
    elements.editorTitle.textContent = "新建排期";
    elements.entryId.value = "";
    elements.entryTitle.value = "";
    elements.entryDate.value = `${state.month}-01`;
    elements.entryTime.value = "20:00";
    elements.taskSelect.value = "";
    if (elements.entryPublishCheckbox) elements.entryPublishCheckbox.checked = false;
    if (elements.entryAllowDelayCheckbox) elements.entryAllowDelayCheckbox.checked = false;
    if (elements.entryDelayMinutesInput) elements.entryDelayMinutesInput.value = 120;
    if (elements.entryDelayOptionsRow) elements.entryDelayOptionsRow.classList.add("hidden");
    elements.legacyNotice.classList.add("hidden");
    elements.taskLinkBox.classList.add("hidden");
    elements.saveEntryBtn.disabled = !state.plan || state.plan.status === "locked";
    elements.deleteEntryBtn.disabled = true;
    hideTaskDetail();
    renderCalendarGrid();
    renderUnscheduledList();
  }

  // =========================================================================
  // 🎨 投稿详情卡片与导出成品模块 (all -> post -> cover)
  // =========================================================================

  function hideTaskDetail() {
    state.currentDetail = null;
    if (elements.detailCard) {
      elements.detailCard.classList.add("hidden");
    }
  }

  async function loadAndDisplayTaskDetail(taskId, fallbackTitle = "") {
    if (!taskId) {
      hideTaskDetail();
      return;
    }

    elements.detailCard.classList.remove("hidden");
    elements.detailTitle.textContent = fallbackTitle || taskId;
    elements.detailTaskId.textContent = taskId;
    elements.detailOpenLibraryBtn.href = `/library?submission_id=${encodeURIComponent(taskId)}`;
    elements.detailThumbsContainer.innerHTML = '<div class="detail-thumbs-empty">正在加载投稿详情与选集图片...</div>';

    try {
      let subData = state.taskDetailsCache.get(taskId);
      if (!subData) {
        const [subRes, buildRes] = await Promise.all([
          fetch(`/api/submissions/${encodeURIComponent(taskId)}`),
          fetch(`/api/submissions/${encodeURIComponent(taskId)}/latest-build`).catch(() => null),
        ]);
        if (!subRes.ok) throw new Error(`无法读取投稿任务 (${subRes.status})`);
        const sub = await subRes.json();
        const build = buildRes && buildRes.ok ? await buildRes.json() : null;
        subData = { ...sub, latestBuild: build };
        state.taskDetailsCache.set(taskId, subData);
      }

      state.currentDetail = subData;
      renderDetailCard(subData);
    } catch (err) {
      console.warn("加载投稿详情失败", err);
      elements.detailThumbsContainer.innerHTML = `<div class="detail-thumbs-empty">${escapeHtml(err.message)}</div>`;
    }
  }

  function displayInlineDetail(entry) {
    elements.detailCard.classList.remove("hidden");
    elements.detailTitle.textContent = entry.title || "旧格式散图投稿";
    elements.detailTaskId.textContent = `entry: ${entry.entry_id}`;
    elements.detailExportStatus.textContent = "散图排期";
    elements.detailExportStatus.className = "detail-status-tag";
    elements.detailOpenLibraryBtn.href = `/library?plan_id=${encodeURIComponent(state.month)}&entry_id=${encodeURIComponent(entry.entry_id)}`;

    const sets = entry.content?.sets || { all: [], post: [], cover: [] };
    state.currentDetail = {
      isInline: true,
      title: entry.title,
      sets: sets,
      latestBuild: null,
    };
    renderDetailCard(state.currentDetail);
  }

  function renderDetailCard(detail) {
    if (!detail) return;

    elements.detailTitle.textContent = detail.title || detail.task_id || "投稿任务";
    elements.detailTaskId.textContent = detail.task_id || "inline_selection";

    if (elements.detailDeleteSubmissionBtn) {
      elements.detailDeleteSubmissionBtn.classList.toggle("hidden", !!detail.isInline);
    }

    // 1. 选集素材数量 (all -> post -> cover)
    const sets = detail.sets || { all: [], post: [], cover: [] };
    elements.detailCountAll.textContent = String(sets.all?.length || 0);
    elements.detailCountPost.textContent = String(sets.post?.length || 0);
    elements.detailCountCover.textContent = String(sets.cover?.length || 0);

    if (elements.detailPixivStatus) {
      if (detail.pixiv && detail.pixiv.illust_id) {
        elements.detailPixivStatus.classList.remove("hidden");
        const pubTimeText = detail.pixiv.published_at ? ` (实际发布时间: ${formatPublishedAt(detail.pixiv.published_at)})` : "";
        elements.detailPixivStatus.innerHTML = `<a href="https://www.pixiv.net/artworks/${encodeURIComponent(detail.pixiv.illust_id)}" target="_blank">✓ Pixiv: PID ${escapeHtml(detail.pixiv.illust_id)} ↗</a><span style="font-size:12px;color:var(--text-muted, #64748b);margin-left:8px;">${escapeHtml(pubTimeText)}</span>`;
      } else {
        elements.detailPixivStatus.classList.add("hidden");
      }
    }

    // Pixiv 发布与定时管理
    if (elements.detailPixivBox) {
      if (detail.isInline) {
        elements.detailPixivBox.classList.add("hidden");
      } else {
        elements.detailPixivBox.classList.remove("hidden");
        const pix = detail.pixiv || {};
        if (pix.illust_id) {
          const pubTimeSuffix = pix.published_at ? ` (${formatPublishedAt(pix.published_at).slice(5, 16)})` : "";
          elements.detailPublishToPixivBtn.textContent = `✓ 已发布 (PID: ${pix.illust_id})${pubTimeSuffix}`;
          elements.detailPublishToPixivBtn.disabled = true;
        } else {
          elements.detailPublishToPixivBtn.textContent = "🚀 立即发布";
          elements.detailPublishToPixivBtn.disabled = false;
        }

        if (elements.detailScheduleAllowDelayCheckbox) {
          elements.detailScheduleAllowDelayCheckbox.checked = Boolean(detail.allow_delay);
        }
        if (elements.detailScheduleDelayMinutesInput) {
          elements.detailScheduleDelayMinutesInput.value = detail.allow_delay ? (detail.max_delay_minutes || 240) : 240;
        }

        if (detail.scheduled_publish) {
          elements.detailSchedulePixivBtn.textContent = "⏹ 取消定时发布";
          elements.detailSchedulePixivBtn.classList.add("active");
          if (elements.detailPixivScheduleStatus) {
            elements.detailPixivScheduleStatus.classList.remove("hidden");
            elements.detailPixivScheduleStatus.className = "pixiv-schedule-status-box active";
            const timeWindow = formatScheduleTimeWindow(detail.scheduled_at, detail.allow_delay, detail.max_delay_minutes);
            const delayTag = detail.allow_delay && detail.max_delay_minutes > 0 ? "" : " (准时)";
            elements.detailPixivScheduleStatus.innerHTML = `<span>⏰ 定时发布中${delayTag}：将于 <strong>${escapeHtml(timeWindow)}</strong> 自动发布</span>`;
          }
        } else {
          elements.detailSchedulePixivBtn.textContent = "⏰ 开启定时发布";
          elements.detailSchedulePixivBtn.classList.remove("active");
          if (elements.detailPixivScheduleStatus) {
            elements.detailPixivScheduleStatus.classList.add("hidden");
          }
        }
      }
    }

    // 渲染选集图片缩略图
    renderDetailThumbsGrid();

    // 2. 导出成品处理
    const build = detail.latestBuild;
    if (build && build.has_build) {
      elements.detailExportStatus.textContent = `✅ 已导出构建 (${build.build_id || "latest"})`;
      elements.detailExportStatus.className = "detail-status-tag success";

      elements.detailBuildSection.classList.remove("hidden");
      elements.detailNoBuildBox.classList.add("hidden");

      if (build.exported_at) {
        elements.detailBuildTime.textContent = `导出于 ${build.exported_at.slice(0, 19).replace("T", " ")}`;
      } else {
        elements.detailBuildTime.textContent = "";
      }

      // 导出选集图片数量
      const buildImgs = build.images || { all: [], post: [], cover: [] };
      elements.detailBuildCountAll.textContent = String(buildImgs.all?.length || 0);
      elements.detailBuildCountPost.textContent = String(buildImgs.post?.length || 0);
      elements.detailBuildCountCover.textContent = String(buildImgs.cover?.length || 0);

      // 渲染导出成品缩略图
      renderDetailBuildThumbsGrid();

      // 导出压缩包下载
      elements.detailExportDownloads.innerHTML = "";
      const archives = build.archives || [];
      if (archives.length) {
        elements.detailExportDownloads.classList.remove("hidden");
        for (const arch of archives) {
          const mb = (arch.size_bytes / (1024 * 1024)).toFixed(2);
          const link = document.createElement("a");
          link.className = "detail-download-item";
          link.href = arch.download_url;
          link.download = arch.filename;
          link.innerHTML = `<span>📦 下载 ${escapeHtml(arch.filename)}</span><span>${mb} MB</span>`;
          elements.detailExportDownloads.appendChild(link);
        }
      } else {
        elements.detailExportDownloads.classList.add("hidden");
      }
    } else {
      elements.detailExportStatus.textContent = detail.isInline ? "未转换" : "未导出";
      elements.detailExportStatus.className = "detail-status-tag";

      elements.detailBuildSection.classList.add("hidden");
      elements.detailNoBuildBox.classList.remove("hidden");
    }
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

  function renderDetailThumbsGrid() {
    if (!state.currentDetail || !elements.detailThumbsContainer) return;

    const tab = state.currentDetailTab || "all";
    const sets = state.currentDetail.sets || {};
    const assetList = sets[tab] || [];

    // 更新 Tab 激活状态
    document.querySelectorAll(".detail-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.detailTab === tab);
    });

    elements.detailThumbsContainer.innerHTML = "";

    if (!assetList.length) {
      elements.detailThumbsContainer.innerHTML = `<div class="detail-thumbs-empty">素材库 ${tab} 集合暂无图片</div>`;
      return;
    }

    for (let i = 0; i < assetList.length; i++) {
      const assetId = assetList[i];
      const thumbUrl = `/api/assets/${encodeURIComponent(assetId)}/preview`;
      const item = document.createElement("div");
      item.className = "detail-thumb-item";
      item.title = `点击查看原素材大图 #${i + 1}: ${assetId}`;
      item.innerHTML = `
        <span class="detail-thumb-num">#${i + 1}</span>
        <img class="detail-thumb-img" src="${thumbUrl}" alt="${escapeHtml(assetId)}" loading="lazy">
      `;

      item.addEventListener("click", () => {
        openLightbox(i, assetList, tab, false);
      });

      elements.detailThumbsContainer.appendChild(item);
    }
  }

  function renderDetailBuildThumbsGrid() {
    if (!state.currentDetail?.latestBuild || !elements.detailBuildThumbsContainer) return;

    const tab = state.currentBuildTab || "all";
    const buildImgs = state.currentDetail.latestBuild.images || {};
    const imgList = buildImgs[tab] || [];

    // 更新 Build Tab 激活状态
    document.querySelectorAll(".detail-build-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.buildTab === tab);
    });

    elements.detailBuildThumbsContainer.innerHTML = "";

    if (!imgList.length) {
      elements.detailBuildThumbsContainer.innerHTML = `<div class="detail-thumbs-empty">导出成品 ${tab} 集合暂无图片</div>`;
      return;
    }

    for (let i = 0; i < imgList.length; i++) {
      const imgItem = imgList[i];
      const item = document.createElement("div");
      item.className = "detail-thumb-item";
      const kb = Math.round((imgItem.size_bytes || 0) / 1024);
      item.title = `点击查看导出成品大图 #${i + 1}: ${imgItem.filename} (${kb} KB)`;
      item.innerHTML = `
        <span class="detail-thumb-num">#${i + 1}</span>
        <img class="detail-thumb-img" src="${imgItem.preview_url}" alt="${escapeHtml(imgItem.filename)}" loading="lazy">
      `;

      item.addEventListener("click", () => {
        openLightbox(i, imgList, tab, true);
      });

      elements.detailBuildThumbsContainer.appendChild(item);
    }
  }

  // =========================================================================
  // 🔍 Lightbox 大图预览弹窗 (支持素材原图与导出成品)
  // =========================================================================

  function openLightbox(index, list, setName = "all", isBuild = false) {
    if (!list || !list.length) return;
    state.lightbox.items = list;
    state.lightbox.index = Math.max(0, Math.min(index, list.length - 1));
    state.lightbox.setName = setName;
    state.lightbox.isBuild = isBuild;
    updateLightboxView();
    elements.previewDialog.showModal();
  }

  function updateLightboxView() {
    const { items, index, setName, isBuild } = state.lightbox;
    if (!items.length) return;

    if (isBuild) {
      const item = items[index];
      elements.previewImage.src = item.preview_url;
      elements.lightboxCounter.textContent = `${index + 1} / ${items.length} (导出成品 · ${setName})`;
      const kb = Math.round((item.size_bytes || 0) / 1024);
      elements.lightboxCaption.textContent = `[成品] ${item.filename} (${kb} KB)`;
    } else {
      const assetId = items[index];
      const previewUrl = `/api/assets/${encodeURIComponent(assetId)}/preview`;
      elements.previewImage.src = previewUrl;
      elements.lightboxCounter.textContent = `${index + 1} / ${items.length} (选集素材 · ${setName})`;
      elements.lightboxCaption.textContent = `${state.currentDetail?.title || ""} · ${assetId}`;
    }

    elements.lightboxPrev.disabled = index <= 0;
    elements.lightboxNext.disabled = index >= items.length - 1;
  }

  function lightboxStep(offset) {
    const nextIdx = state.lightbox.index + offset;
    if (nextIdx >= 0 && nextIdx < state.lightbox.items.length) {
      state.lightbox.index = nextIdx;
      updateLightboxView();
    }
  }

  // Lightbox 交互绑定
  elements.lightboxPrev.addEventListener("click", () => lightboxStep(-1));
  elements.lightboxNext.addEventListener("click", () => lightboxStep(1));
  elements.closePreview.addEventListener("click", () => elements.previewDialog.close());

  if (elements.lightboxRevealBtn) {
    elements.lightboxRevealBtn.addEventListener("click", async () => {
      const { items, index, isBuild, setName } = state.lightbox;
      if (!items.length) return;

      if (isBuild) {
        const taskId = state.currentDetail?.task_id;
        const item = items[index];
        if (!taskId || !item?.filename) {
          showNotice("无法定位导出文件", "warning");
          return;
        }
        try {
          const res = await fetch(
            `/api/submissions/${encodeURIComponent(taskId)}/build-images/${encodeURIComponent(setName)}/${encodeURIComponent(item.filename)}/reveal`,
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
      } else {
        const assetId = items[index];
        if (!assetId) return;
        try {
          const res = await fetch(`/api/assets/${encodeURIComponent(assetId)}/reveal`, {
            method: "POST",
          });
          if (res.ok) {
            showNotice("已在资源管理器中定位素材原图文件", "info");
          } else {
            const err = await res.json().catch(() => ({}));
            showNotice(err.detail || "打开文件夹失败", "error");
          }
        } catch (err) {
          showNotice(`打开文件失败: ${err.message}`, "error");
        }
      }
    });
  }

  if (elements.detailOpenBuildDirBtn) {
    elements.detailOpenBuildDirBtn.addEventListener("click", async () => {
      const taskId = state.currentDetail?.task_id;
      if (!taskId) {
        showNotice("未选择投稿任务", "warning");
        return;
      }
      try {
        const res = await fetch(`/api/submissions/${encodeURIComponent(taskId)}/open-latest-build`, {
          method: "POST",
        });
        if (res.ok) {
          showNotice("已在资源管理器中打开导出目录", "info");
        } else {
          const err = await res.json().catch(() => ({}));
          showNotice(err.detail || "打开导出目录失败", "error");
        }
      } catch (err) {
        showNotice(`打开导出目录失败: ${err.message}`, "error");
      }
    });
  }

  document.addEventListener("keydown", (e) => {
    if (!elements.previewDialog.open) return;
    if (e.key === "ArrowLeft") lightboxStep(-1);
    if (e.key === "ArrowRight") lightboxStep(1);
    if (e.key === "Escape") elements.previewDialog.close();
  });

  // Tab 切换事件 (素材选集 Tabs)
  document.querySelectorAll(".detail-tab").forEach((tabBtn) => {
    tabBtn.addEventListener("click", () => {
      state.currentDetailTab = tabBtn.dataset.detailTab;
      renderDetailThumbsGrid();
    });
  });

  // Tab 切换事件 (导出构建 Tabs)
  document.querySelectorAll(".detail-build-tab").forEach((tabBtn) => {
    tabBtn.addEventListener("click", () => {
      state.currentBuildTab = tabBtn.dataset.buildTab;
      renderDetailBuildThumbsGrid();
    });
  });

  // =========================================================================
  // 表单操作与事件绑定
  // =========================================================================


  async function handleFormSubmit(e) {
    e.preventDefault();
    if (!state.plan || state.plan.status === "locked") return;

    const title = elements.entryTitle.value.trim();
    const dateVal = elements.entryDate.value;
    const timeVal = elements.entryTime.value || "20:00";
    const taskId = elements.taskSelect.value.trim();
    const entryIdVal = elements.entryId.value.trim();

    if (!title || !dateVal) {
      showNotice("请填写标题和日期", "warning");
      return;
    }

    let scheduledAt = `${dateVal}T${timeVal}:00+08:00`;

    let contentObj = null;
    if (taskId) {
      contentObj = { kind: "task", task_id: taskId };
    } else {
      contentObj = {
        kind: "inline_selection",
        sets: { all: [], post: [], cover: [] },
      };
    }

    const isEdit = Boolean(entryIdVal);
    const targetEntryId = isEdit ? entryIdVal : `entry-${Date.now().toString(36)}`;

    const isPublish = Boolean(elements.entryPublishCheckbox?.checked);
    const allowDelay = Boolean(elements.entryAllowDelayCheckbox?.checked);
    const maxDelayMinutes = parseInt(elements.entryDelayMinutesInput?.value, 10) || 240;

    const payload = {
      revision: state.plan.revision,
      entry: {
        entry_id: targetEntryId,
        scheduled_at: scheduledAt,
        title: title,
        content: contentObj,
        execution: {
          build_on_due: true,
          notify_on_complete: true,
          publish: isPublish,
          allow_delay: allowDelay,
          max_delay_minutes: maxDelayMinutes,
        },
      },
    };

    try {
      let res;
      if (isEdit) {
        res = await fetch(`/api/plans/${state.month}/entries/${targetEntryId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch(`/api/plans/${state.month}/entries`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        if (res.status === 409) {
          throw new Error("计划已被更新（revision 冲突），请刷新页面后重试。");
        }
        throw new Error(errData.detail?.message || `保存排期失败 (${res.status})`);
      }

      state.plan = await res.json();
      showNotice(isEdit ? "排期已更新" : "排期已创建", "info");
      renderCalendarGrid();
      const updated = (state.plan.entries || []).find((x) => x.entry_id === targetEntryId);
      if (updated) selectEntry(updated);
      loadSubmissionsList();
    } catch (err) {
      showNotice(err.message, "error");
    }
  }

  async function handleDeleteEntry() {
    if (!state.plan || !state.selectedEntryId || state.plan.status === "locked") return;
    if (!confirm("确定要删除此排期吗？")) return;

    try {
      const res = await fetch(
        `/api/plans/${state.month}/entries/${state.selectedEntryId}?revision=${state.plan.revision}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail?.message || `删除排期失败 (${res.status})`);
      }
      state.plan = await res.json();
      showNotice("排期已删除", "info");
      resetEditor();
      loadSubmissionsList();
    } catch (err) {
      showNotice(err.message, "error");
    }
  }

  async function handleDetailDeleteSubmission() {
    const detail = state.currentDetail;
    if (!detail || !detail.task_id || detail.isInline) return;
    const title = detail.title || detail.task_id;
    if (
      !confirm(
        `确定要删除投稿任务【${title}】吗？\n\n删除后将彻底移除该投稿任务及月度排期，并自动清理不再被引用的图片的「已投稿」标记。`
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/submissions/${encodeURIComponent(detail.task_id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail?.message || `删除投稿失败 (${res.status})`);
      }
      showNotice(`已成功删除投稿【${title}】`, "info");
      hideTaskDetail();
      await Promise.all([loadPlan(state.month), loadSubmissionsList()]);
      resetEditor();
    } catch (err) {
      showNotice(err.message, "error");
    }
  }

  async function handleDetailPublishToPixiv() {
    const detail = state.currentDetail;
    if (!detail || !detail.task_id || detail.isInline) return;
    const title = detail.title || detail.task_id;
    if (!confirm(`确定要立即将【${title}】发布到 Pixiv 吗？`)) return;

    if (elements.detailPublishToPixivBtn) {
      elements.detailPublishToPixivBtn.disabled = true;
    }
    showNotice(`正在发布【${title}】到 Pixiv...`, "info");

    try {
      const res = await fetch(`/api/submissions/${encodeURIComponent(detail.task_id)}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force_rebuild: false, force_republish: false }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail?.message || data.detail || "发布失败");
      }
      showNotice(`🎉 ${data.message || "发布成功！"}`, "info");
      state.taskDetailsCache.delete(detail.task_id);
      await loadAndDisplayTaskDetail(detail.task_id, detail.title);
      await loadSubmissionsList();
    } catch (err) {
      showNotice(`发布失败: ${err.message}`, "error");
    } finally {
      if (elements.detailPublishToPixivBtn) {
        elements.detailPublishToPixivBtn.disabled = false;
      }
    }
  }

  async function handleDetailToggleSchedulePublish() {
    const detail = state.currentDetail;
    if (!detail || !detail.task_id || detail.isInline) return;

    const enabling = !detail.scheduled_publish;
    const allowDelay = Boolean(elements.detailScheduleAllowDelayCheckbox?.checked);
    const maxDelayMinutes = parseInt(elements.detailScheduleDelayMinutesInput?.value, 10) || 240;

    let schedAt = detail.scheduled_at;
    if (enabling && !schedAt) {
      const dateVal = elements.entryDate?.value?.trim();
      const timeVal = elements.entryTime?.value?.trim() || "20:00";
      if (dateVal) {
        schedAt = `${dateVal}T${timeVal}:00+08:00`;
      } else {
        showNotice("请先设置排期日期和时间后再开启定时发布", "warning");
        return;
      }
    }

    if (elements.detailSchedulePixivBtn) {
      elements.detailSchedulePixivBtn.disabled = true;
    }
    try {
      const res = await fetch(`/api/submissions/${encodeURIComponent(detail.task_id)}/schedule-publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enable: enabling,
          scheduled_at: schedAt,
          allow_delay: allowDelay,
          max_delay_minutes: maxDelayMinutes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const detailErr = data.detail || {};
        const msg = detailErr.message || (typeof data.detail === "string" ? data.detail : "操作失败");
        throw new Error(msg);
      }
      showNotice(data.message || (enabling ? "已开启定时发布" : "已取消定时发布"), "info");
      state.taskDetailsCache.delete(detail.task_id);
      await loadPlan(state.month);
      await loadAndDisplayTaskDetail(detail.task_id, detail.title);
      await loadSubmissionsList();
    } catch (err) {
      showNotice(`定时发布设置失败: ${err.message}`, "error");
    } finally {
      if (elements.detailSchedulePixivBtn) {
        elements.detailSchedulePixivBtn.disabled = false;
      }
    }
  }

  // 事件监听绑定
  elements.monthPicker.addEventListener("change", (e) => {
    if (e.target.value) loadPlan(e.target.value);
  });
  elements.prevMonth.addEventListener("click", () => {
    loadPlan(shiftMonth(state.month, -1));
  });
  elements.nextMonth.addEventListener("click", () => {
    loadPlan(shiftMonth(state.month, 1));
  });
  elements.newEntryBtn.addEventListener("click", () => {
    resetEditor();
  });
  elements.resetEditorBtn.addEventListener("click", () => {
    resetEditor();
  });
  elements.entryForm.addEventListener("submit", handleFormSubmit);
  elements.deleteEntryBtn.addEventListener("click", handleDeleteEntry);
  if (elements.detailDeleteSubmissionBtn) {
    elements.detailDeleteSubmissionBtn.addEventListener("click", handleDetailDeleteSubmission);
  }
  if (elements.detailPublishToPixivBtn) {
    elements.detailPublishToPixivBtn.addEventListener("click", handleDetailPublishToPixiv);
  }
  if (elements.detailSchedulePixivBtn) {
    elements.detailSchedulePixivBtn.addEventListener("click", handleDetailToggleSchedulePublish);
  }

  if (elements.entryPublishCheckbox) {
    elements.entryPublishCheckbox.addEventListener("change", (e) => {
      if (elements.entryDelayOptionsRow) {
        elements.entryDelayOptionsRow.classList.toggle("hidden", !e.target.checked);
      }
    });
  }

  if (elements.unscheduledSearchInput) {
    elements.unscheduledSearchInput.addEventListener("input", (e) => {
      state.unscheduledSearchQuery = e.target.value;
      renderUnscheduledList();
    });
  }

  if (elements.refreshUnscheduledBtn) {
    elements.refreshUnscheduledBtn.addEventListener("click", () => {
      loadSubmissionsList();
    });
  }

  elements.taskSelect.addEventListener("change", (e) => {
    const selectedTaskId = e.target.value;
    if (selectedTaskId) {
      elements.taskLinkBox.classList.remove("hidden");
      elements.gotoLibraryLink.href = `/library?submission_id=${encodeURIComponent(selectedTaskId)}`;
      elements.legacyNotice.classList.add("hidden");
      loadAndDisplayTaskDetail(selectedTaskId);
    } else {
      elements.taskLinkBox.classList.add("hidden");
      hideTaskDetail();
    }
  });

  // 初始化
  loadSubmissionsList();
  loadPlan(getQueryMonth());
})();


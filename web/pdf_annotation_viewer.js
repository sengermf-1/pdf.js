/* Copyright 2026 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* Modified from the original Mozilla PDF.js source on 2026-03-14.
 * Added a custom annotations sidebar viewer with navigation and comment editing integration.
 */

/** @typedef {import("./event_utils.js").EventBus} EventBus */
/** @typedef {import("./pdf_link_service.js").PDFLinkService} PDFLinkService */
/** @typedef {import("./pdf_viewer.js").PDFViewer} PDFViewer */

import { AnnotationType, PDFDateString, stopEvent } from "pdfjs-lib";
import { BaseTreeViewer } from "./base_tree_viewer.js";

const ANNOTATION_EDITOR_PREFIX = "pdfjs_internal_editor_";
const POINTER_HIGHLIGHT_CLASS = "annotationPointerActive";
const NO_ANNOTATIONS_MESSAGE = "No annotations in this document.";
const UNKNOWN_AUTHOR_LABEL = "Unknown author";
const UNKNOWN_DATE_LABEL = "No date";

const ANNOTATION_KIND = Object.freeze({
  NOTE: "note",
  MARKUP: "markup",
  FORM: "form",
  INK: "ink",
  SHAPE: "shape",
  ATTACHMENT: "attachment",
  STAMP: "stamp",
  DEFAULT: "default",
});

const ANNOTATION_LABELS = Object.freeze({
  [AnnotationType.TEXT]: "Note",
  [AnnotationType.FREETEXT]: "Free text",
  [AnnotationType.LINE]: "Line",
  [AnnotationType.SQUARE]: "Rectangle",
  [AnnotationType.CIRCLE]: "Ellipse",
  [AnnotationType.POLYLINE]: "Polyline",
  [AnnotationType.CARET]: "Caret",
  [AnnotationType.INK]: "Ink",
  [AnnotationType.POLYGON]: "Polygon",
  [AnnotationType.HIGHLIGHT]: "Highlight",
  [AnnotationType.UNDERLINE]: "Underline",
  [AnnotationType.SQUIGGLY]: "Squiggly",
  [AnnotationType.STRIKEOUT]: "Strikeout",
  [AnnotationType.STAMP]: "Stamp",
  [AnnotationType.FILEATTACHMENT]: "Attachment",
});

const WIDGET_LABELS = Object.freeze({
  Tx: "Text field",
  Btn: "Button field",
  Ch: "Choice field",
  Sig: "Signature field",
});

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function hasRect(annotation) {
  return (
    Array.isArray(annotation.rect) &&
    annotation.rect.length === 4 &&
    annotation.rect.every(Number.isFinite)
  );
}

function isListableAnnotation(annotation) {
  return (
    hasRect(annotation) &&
    !annotation.noView &&
    annotation.annotationType !== AnnotationType.LINK &&
    annotation.annotationType !== AnnotationType.POPUP
  );
}

function sortAnnotations(a, b) {
  if (a.pageIndex !== b.pageIndex) {
    return a.pageIndex - b.pageIndex;
  }

  const rectA = a.rect || [0, 0, 0, 0];
  const rectB = b.rect || [0, 0, 0, 0];

  if (rectA[3] !== rectB[3]) {
    return rectB[3] - rectA[3];
  }
  if (rectA[0] !== rectB[0]) {
    return rectA[0] - rectB[0];
  }
  if (rectA[1] !== rectB[1]) {
    return rectB[1] - rectA[1];
  }
  if (rectA[2] !== rectB[2]) {
    return rectA[2] - rectB[2];
  }
  return String(a.id).localeCompare(String(b.id));
}

function getAnnotationLabel(annotation) {
  if (annotation.annotationType === AnnotationType.WIDGET) {
    return WIDGET_LABELS[annotation.fieldType] || "Form field";
  }
  return ANNOTATION_LABELS[annotation.annotationType] || "Annotation";
}

function getAnnotationKind(annotation) {
  switch (annotation.annotationType) {
    case AnnotationType.TEXT:
    case AnnotationType.FREETEXT:
      return ANNOTATION_KIND.NOTE;
    case AnnotationType.HIGHLIGHT:
    case AnnotationType.UNDERLINE:
    case AnnotationType.SQUIGGLY:
    case AnnotationType.STRIKEOUT:
      return ANNOTATION_KIND.MARKUP;
    case AnnotationType.WIDGET:
      return ANNOTATION_KIND.FORM;
    case AnnotationType.INK:
      return ANNOTATION_KIND.INK;
    case AnnotationType.LINE:
    case AnnotationType.SQUARE:
    case AnnotationType.CIRCLE:
    case AnnotationType.POLYLINE:
    case AnnotationType.POLYGON:
    case AnnotationType.CARET:
      return ANNOTATION_KIND.SHAPE;
    case AnnotationType.FILEATTACHMENT:
      return ANNOTATION_KIND.ATTACHMENT;
    case AnnotationType.STAMP:
      return ANNOTATION_KIND.STAMP;
    default:
      return ANNOTATION_KIND.DEFAULT;
  }
}

function toText(value) {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(toText).filter(Boolean).join(", ");
  }
  if (value && typeof value === "object") {
    if (typeof value.str === "string") {
      return value.str;
    }
    if (typeof value.filename === "string") {
      return value.filename;
    }
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function getAnnotationAuthor(annotation) {
  return (
    toText(annotation.titleObj) ||
    toText(annotation.title) ||
    UNKNOWN_AUTHOR_LABEL
  );
}

function getAnnotationDate(annotation) {
  return toDateObject(annotation.modificationDate || annotation.creationDate);
}

function toDateObject(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.valueOf()) ? null : value;
  }
  const date = PDFDateString.toDateObject(value) || null;
  return Number.isNaN(date?.valueOf()) ? null : date;
}

class PDFAnnotationViewer extends BaseTreeViewer {
  /**
   * @param {Object} options
 * @param {HTMLDivElement} options.container
 * @param {import("./comment_manager.js").CommentManager | null} [options.commentManager]
 * @param {EventBus} options.eventBus
 * @param {L10n} options.l10n
   * @param {PDFLinkService} options.linkService
   * @param {PDFViewer} options.pdfViewer
   * @param {HTMLDivElement} options.viewerContainer
   * @param {HTMLDivElement} options.overlayContainer
   * @param {AbortSignal} [options.globalAbortSignal]
   */
  constructor(options) {
    super(options);

    this.commentManager = options.commentManager || null;
    this.linkService = options.linkService;
    this.pdfViewer = options.pdfViewer;
    this.viewerContainer = options.viewerContainer;
    this.overlayContainer = options.overlayContainer;
    this.eventBus = options.eventBus;
    this.globalAbortSignal = options.globalAbortSignal || null;
    this._isLTR = document.documentElement.dir !== "rtl";
    this._dateFormat = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
    this._commentDialog = document.getElementById("commentManagerDialog");
    this._commentSaveButton = document.getElementById(
      "commentManagerSaveButton"
    );
    this._commentTextInput = document.getElementById("commentManagerTextInput");

    this._annotations = [];
    this._annotationRows = new Map();
    this._selectedAnnotation = null;
    this._selectedAnnotationElement = null;
    this._editingAnnotationId = null;
    this._commentRefreshTimeoutId = null;
    this._pointerSyncId = 0;
    this._renderId = 0;

    this._createPointerOverlay();
    this._bindEvents();
  }

  reset() {
    super.reset();
    if (this._commentRefreshTimeoutId !== null) {
      window.clearTimeout(this._commentRefreshTimeoutId);
      this._commentRefreshTimeoutId = null;
    }
    this._renderId = (this._renderId || 0) + 1;
    this._annotations = [];
    this._annotationRows?.clear();
    this._selectedAnnotation = null;
    this._editingAnnotationId = null;
    this._hidePointer();
  }

  _dispatchEvent(annotationsCount) {
    this.eventBus.dispatch("annotationsloaded", {
      source: this,
      annotationsCount,
    });
  }

  _bindLink(button, { annotation, treeItem }) {
    button.addEventListener("click", () => {
      this._activateAnnotation(annotation, treeItem);
    });
    button.addEventListener("keydown", evt => {
      this._annotationKeydown(evt, treeItem);
    });
  }

  async render({ pdfDocument }) {
    this.reset();
    this._pdfDocument = pdfDocument || null;

    if (!pdfDocument) {
      this._dispatchEvent(0);
      return;
    }

    const renderId = this._renderId;
    let annotations;
    try {
      annotations = await pdfDocument.getAnnotationsByType(null);
    } catch (reason) {
      console.error("PDFAnnotationViewer.render:", reason);
      if (this._pdfDocument === pdfDocument && renderId === this._renderId) {
        this._renderEmptyState();
      }
      return;
    }

    if (this._pdfDocument !== pdfDocument || renderId !== this._renderId) {
      return;
    }

    annotations ||= [];
    this._annotations = annotations
      .filter(isListableAnnotation)
      .sort(sortAnnotations);

    if (this._annotations.length === 0) {
      this._renderEmptyState();
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const annotation of this._annotations) {
      fragment.append(this._createAnnotationElement(annotation));
    }
    this._finishRendering(fragment, this._annotations.length);
  }

  _createAnnotationElement(annotation) {
    const treeItem = document.createElement("div");
    treeItem.className = "treeItem treeItemLeaf";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "treeItemLabel annotationItemButton";
    button.dataset.annotationKind = getAnnotationKind(annotation);
    button.setAttribute("aria-pressed", "false");

    const icon = document.createElement("span");
    icon.className = "annotationItemIcon";
    icon.setAttribute("aria-hidden", "true");

    const body = document.createElement("span");
    body.className = "annotationItemBody";

    const header = document.createElement("span");
    header.className = "annotationItemHeader";

    const author = document.createElement("span");
    author.className = "annotationItemAuthor";
    author.textContent = this._normalizeTextContent(
      getAnnotationAuthor(annotation)
    );

    const date = document.createElement("time");
    date.className = "annotationItemDate";
    this._setAnnotationDate(date, annotation);

    const meta = document.createElement("span");
    meta.className = "annotationItemMeta";

    const type = document.createElement("span");
    type.className = "annotationItemType";
    type.textContent = getAnnotationLabel(annotation);

    const page = document.createElement("span");
    page.className = "annotationItemPage";
    page.textContent = `Page ${annotation.pageIndex + 1}`;

    const preview = document.createElement("span");
    preview.className = "annotationItemPreview";
    preview.textContent = this._getPreviewText(annotation);
    button.title = preview.textContent;

    header.append(author, date);
    meta.append(type, page);
    body.append(header, meta, preview);
    button.append(icon, body);
    treeItem.append(button);

    if (this._canEditAnnotation(annotation)) {
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "annotationItemEditButton";
      editButton.title = "Edit comment";
      editButton.setAttribute("aria-label", "Edit comment");
      editButton.addEventListener("click", evt => {
        stopEvent(evt);
        this._editAnnotationComment(annotation, treeItem);
      });
      treeItem.append(editButton);
    }

    this._bindLink(button, { annotation, treeItem });
    this._annotationRows.set(annotation.id, treeItem);
    return treeItem;
  }

  _canEditAnnotation(annotation) {
    return !!(annotation && (annotation.isEditable || this.commentManager));
  }

  _renderEmptyState() {
    const fragment = document.createDocumentFragment();
    const treeItem = document.createElement("div");
    treeItem.className = "treeItem annotationListEmpty";

    const message = document.createElement("div");
    message.className = "annotationEmptyState";
    message.textContent = NO_ANNOTATIONS_MESSAGE;
    treeItem.append(message);

    fragment.append(treeItem);
    this._finishRendering(fragment, 0);
  }

  _getPreviewText(annotation) {
    const storedComment = this._getStoredCommentState(annotation);
    if (storedComment?.hasOverride) {
      return this._normalizeTextContent(
        storedComment.text.trim() || getAnnotationLabel(annotation)
      );
    }

    const fieldText =
      annotation.fieldName && annotation.fieldValue !== undefined
        ? `${toText(annotation.fieldName)}: ${toText(annotation.fieldValue)}`
        : toText(annotation.fieldValue ?? annotation.fieldName);

    const preview =
      toText(annotation.contentsObj) ||
      fieldText ||
      toText(annotation.alternativeText) ||
      toText(annotation.file) ||
      toText(annotation.url) ||
      toText(annotation.titleObj) ||
      getAnnotationLabel(annotation);

    return this._normalizeTextContent(preview.replaceAll(/\s+/g, " ").trim());
  }

  _setAnnotationDate(element, annotation) {
    const storedComment = this._getStoredCommentState(annotation);
    const date = storedComment?.hasOverride
      ? toDateObject(storedComment.date)
      : getAnnotationDate(annotation);
    if (!date) {
      element.textContent = UNKNOWN_DATE_LABEL;
      element.removeAttribute("dateTime");
      return;
    }
    element.dateTime = date.toISOString();
    element.textContent = this._dateFormat.format(date);
  }

  _annotationKeydown(evt, treeItem) {
    const treeItems = Array.from(
      this.container.querySelectorAll(".treeItem:not(.annotationListEmpty)")
    );
    if (treeItems.length === 0) {
      return;
    }
    const index = treeItems.indexOf(treeItem);

    switch (evt.key) {
      case "ArrowDown":
        treeItems[(index + 1) % treeItems.length]
          ?.querySelector("button")
          ?.focus();
        stopEvent(evt);
        break;
      case "ArrowUp":
        treeItems[(index + treeItems.length - 1) % treeItems.length]
          ?.querySelector("button")
          ?.focus();
        stopEvent(evt);
        break;
      case "Home":
        treeItems[0]?.querySelector("button")?.focus();
        stopEvent(evt);
        break;
      case "End":
        treeItems.at(-1)?.querySelector("button")?.focus();
        stopEvent(evt);
        break;
    }
  }

  _activateAnnotation(annotation, treeItem, { toggle = true } = {}) {
    if (toggle && this._selectedAnnotation?.id === annotation.id) {
      this._deactivateAnnotation();
      return;
    }

    this._setTreeItemPressed(this._currentTreeItem, false);
    this._selectedAnnotation = annotation;
    this._scrollToCurrentTreeItem(treeItem);
    this._setTreeItemPressed(treeItem, true);

    const [x1, , x2, y2] = annotation.rect;
    this.linkService.goToXY(annotation.pageIndex + 1, (x1 + x2) / 2, y2, {
      center: "both",
    });

    this._schedulePointerSync();
  }

  async _editAnnotationComment(annotation, treeItem) {
    this._activateAnnotation(annotation, treeItem, { toggle: false });
    this._editingAnnotationId = annotation.id;

    const editableAnnotation =
      await this._waitForEditableAnnotation(annotation);
    if (editableAnnotation) {
      const editablePopup = this._getEditablePopup(editableAnnotation);
      if (editablePopup) {
        editablePopup.editComment();
        return;
      }

      const commentManager = this.commentManager || this._getCommentManager(annotation);
      const fallbackEditor =
        this._createFallbackCommentEditor(editableAnnotation);
      if (!commentManager || !fallbackEditor) {
        this._editingAnnotationId = null;
        return;
      }

      const [posX, posY] = fallbackEditor.commentPopupPosition;
      const parentDimensions = fallbackEditor.parentBoundingClientRect;
      commentManager.showDialog(
        null,
        fallbackEditor,
        parentDimensions.x + posX * parentDimensions.width,
        parentDimensions.y + posY * parentDimensions.height,
        { parentDimensions }
      );
      return;
    }

    const storageEditor = this._createStorageBackedCommentEditor(
      annotation,
      treeItem
    );
    const commentManager = this.commentManager || this._getCommentManager(annotation);
    if (!commentManager || !storageEditor) {
      this._editingAnnotationId = null;
      return;
    }

    const [posX, posY] = storageEditor.commentPopupPosition;
    const parentDimensions = storageEditor.parentBoundingClientRect;
    commentManager.showDialog(
      null,
      storageEditor,
      parentDimensions.x + posX * parentDimensions.width,
      parentDimensions.y + posY * parentDimensions.height,
      { parentDimensions }
    );
  }

  _deactivateAnnotation() {
    this._selectedAnnotation = null;
    this._setTreeItemPressed(this._currentTreeItem, false);
    this._updateCurrentTreeItem(null);
    this._hidePointer();
  }

  _bindEvents() {
    if (!this.globalAbortSignal) {
      return;
    }

    const schedulePointerSync = this._schedulePointerSync.bind(this);
    this.container.parentElement?.addEventListener(
      "scroll",
      schedulePointerSync,
      {
        signal: this.globalAbortSignal,
      }
    );
    for (const name of [
      "annotationlayerrendered",
      "pagerendered",
      "resize",
      "rotationchanging",
      "scalechanging",
      "sidebarviewchanged",
      "updateviewarea",
    ]) {
      this.eventBus._on(name, schedulePointerSync, {
        signal: this.globalAbortSignal,
      });
    }
    this._commentDialog?.addEventListener(
      "close",
      () => {
        if (!this._commentRefreshTimeoutId) {
          this._editingAnnotationId = null;
        }
      },
      { signal: this.globalAbortSignal }
    );
    this._commentSaveButton?.addEventListener(
      "click",
      () => {
        this._queueEditedAnnotationRefresh();
      },
      { signal: this.globalAbortSignal }
    );
    this._commentTextInput?.addEventListener(
      "keydown",
      evt => {
        if ((evt.ctrlKey || evt.metaKey) && evt.key === "Enter") {
          this._queueEditedAnnotationRefresh();
        }
      },
      { signal: this.globalAbortSignal }
    );
  }

  _schedulePointerSync() {
    if (!this._selectedAnnotation || this._pointerSyncId) {
      return;
    }
    this._pointerSyncId = window.requestAnimationFrame(() => {
      this._pointerSyncId = 0;
      this._syncPointer();
    });
  }

  _createPointerOverlay() {
    if (!this.overlayContainer) {
      return;
    }

    const overlay = document.createElement("div");
    overlay.className = "annotationPointerOverlay hidden";
    overlay.setAttribute("aria-hidden", "true");

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("annotationPointerCanvas");

    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    const marker = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "marker"
    );
    this._pointerMarkerId = `annotationPointerArrowHead_${Math.random()
      .toString(36)
      .slice(2)}`;
    marker.setAttribute("id", this._pointerMarkerId);
    marker.setAttribute("markerUnits", "strokeWidth");
    marker.setAttribute("viewBox", "0 0 12 12");
    marker.setAttribute("markerWidth", "4");
    marker.setAttribute("markerHeight", "4");
    marker.setAttribute("refX", "10.8");
    marker.setAttribute("refY", "6");
    marker.setAttribute("orient", "auto-start-reverse");
    marker.setAttribute("overflow", "visible");
    const arrowPath = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path"
    );
    arrowPath.setAttribute("d", "M 1 1.25 L 11 6 L 1 10.75 L 3.9 6 z");
    arrowPath.classList.add("annotationPointerArrowHead");
    marker.append(arrowPath);
    defs.append(marker);

    const trail = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path"
    );
    trail.classList.add("annotationPointerTrail");

    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    line.classList.add("annotationPointerLine");
    line.setAttribute("marker-end", `url(#${this._pointerMarkerId})`);

    svg.append(defs, trail, line);

    overlay.append(svg);
    this.overlayContainer.append(overlay);

    this._pointerOverlay = overlay;
    this._pointerSvg = svg;
    this._pointerTrail = trail;
    this._pointerLine = line;
  }

  _syncPointer() {
    const annotation = this._selectedAnnotation;
    if (!annotation || !this._pointerOverlay || !this.viewerContainer) {
      this._hidePointer();
      return;
    }

    const geometry = this._getAnnotationGeometry(annotation);
    if (!geometry) {
      this._hidePointer();
      return;
    }

    const overlayRect = this.overlayContainer.getBoundingClientRect();
    const viewerRect = this.viewerContainer.getBoundingClientRect();
    if (!overlayRect.width || !overlayRect.height || !viewerRect.width) {
      this._hidePointer();
      return;
    }

    const startPoint = this._getSidebarAnchorPoint(overlayRect, annotation.id);
    if (!startPoint) {
      this._hidePointer();
      return;
    }

    const viewerLeft = viewerRect.left - overlayRect.left + 18;
    const viewerTop = viewerRect.top - overlayRect.top + 18;
    const viewerRight = viewerRect.right - overlayRect.left - 18;
    const viewerBottom = viewerRect.bottom - overlayRect.top - 18;

    const targetX = clamp(
      geometry.x,
      viewerLeft,
      Math.max(viewerLeft, viewerRight)
    );
    const targetY = clamp(
      geometry.y,
      viewerTop,
      Math.max(viewerTop, viewerBottom)
    );
    const offscreen = targetX !== geometry.x || targetY !== geometry.y;

    this._setHighlightedAnnotationElement(geometry.element);

    this._pointerOverlay.classList.remove("hidden");
    this._pointerOverlay.classList.toggle("offscreen", offscreen);
    this._pointerSvg.setAttribute(
      "viewBox",
      `0 0 ${Math.max(overlayRect.width, 1)} ${Math.max(overlayRect.height, 1)}`
    );

    const { x: startX, y: startY } = startPoint;
    const horizontalDistance = Math.abs(targetX - startX);
    const verticalDistance = targetY - startY;
    const horizontalOffset = clamp(horizontalDistance * 0.38, 54, 180);
    const bowDirection = verticalDistance >= 0 ? 1 : -1;
    const minimumBow = clamp(horizontalDistance * 0.12, 28, 88);
    const bowMagnitude = Math.max(
      minimumBow,
      clamp(Math.abs(verticalDistance) * 0.34, 20, 112)
    );
    const direction = this._isLTR ? 1 : -1;
    const firstControlX = startX + direction * horizontalOffset;
    const firstControlY = startY + bowDirection * bowMagnitude * 0.24;
    const secondControlX = targetX - direction * horizontalOffset * 0.88;
    const secondControlY = targetY + bowDirection * bowMagnitude * 0.18;
    const pathData = [
      `M ${startX} ${startY}`,
      `C ${firstControlX} ${firstControlY}`,
      `${secondControlX} ${secondControlY}`,
      `${targetX} ${targetY}`,
    ].join(" ");

    this._pointerTrail.setAttribute("d", pathData);
    this._pointerLine.setAttribute("d", pathData);
  }

  _getAnnotationGeometry(annotation) {
    const pageView = this.pdfViewer.getPageView(annotation.pageIndex);
    const pageElement = pageView?.div;
    const viewport = pageView?.viewport;

    if (!pageElement || !viewport) {
      return null;
    }

    const rect = annotation.rect;
    const x = (rect[0] + rect[2]) / 2;
    const y = (rect[1] + rect[3]) / 2;
    const [viewportX, viewportY] = viewport.convertToViewportPoint(x, y);
    const pageRect = pageElement.getBoundingClientRect();

    return {
      element: this._getAnnotationElement(pageElement, annotation.id),
      x:
        pageRect.left -
        this.overlayContainer.getBoundingClientRect().left +
        viewportX,
      y:
        pageRect.top -
        this.overlayContainer.getBoundingClientRect().top +
        viewportY,
    };
  }

  _getAnnotationElement(pageElement, annotationId) {
    if (
      this._selectedAnnotationElement?.isConnected &&
      this._selectedAnnotationElement.getAttribute("data-annotation-id") ===
        annotationId
    ) {
      return this._selectedAnnotationElement;
    }

    const escapedId = globalThis.CSS?.escape
      ? CSS.escape(String(annotationId))
      : String(annotationId);
    const selector = `[data-annotation-id="${escapedId}"]`;
    let element = null;
    try {
      element = pageElement.querySelector(selector);
    } catch {
      for (const candidate of pageElement.querySelectorAll(
        "[data-annotation-id]"
      )) {
        if (candidate.getAttribute("data-annotation-id") === annotationId) {
          element = candidate;
          break;
        }
      }
    }
    return element;
  }

  _setHighlightedAnnotationElement(element) {
    if (this._selectedAnnotationElement === element) {
      return;
    }

    this._selectedAnnotationElement?.classList.remove(POINTER_HIGHLIGHT_CLASS);
    this._selectedAnnotationElement = element || null;
    this._selectedAnnotationElement?.classList.add(POINTER_HIGHLIGHT_CLASS);
  }

  _setTreeItemPressed(treeItem, pressed) {
    treeItem
      ?.querySelector(".annotationItemButton")
      ?.setAttribute("aria-pressed", pressed ? "true" : "false");
  }

  _getStoredCommentState(annotation) {
    const annotationStorage = this.pdfViewer.pdfDocument?.annotationStorage;
    const editorComment = annotationStorage?.getEditor(annotation.id)?.comment;
    if (editorComment) {
      return {
        hasOverride: true,
        date: editorComment.date,
        text: editorComment.deleted ? "" : editorComment.text || "",
      };
    }

    const storedData = annotationStorage?.getRawValue(
      `${ANNOTATION_EDITOR_PREFIX}${annotation.id}`
    );
    if (!storedData?.popup) {
      return null;
    }
    return {
      hasOverride: true,
      date: storedData.modificationDate,
      text: storedData.popup.deleted ? "" : storedData.popup.contents || "",
    };
  }

  _refreshAnnotationRow(annotationId) {
    const annotation = this._annotations.find(item => item.id === annotationId);
    const treeItem = this._annotationRows.get(annotationId);
    if (!annotation || !treeItem) {
      return;
    }

    const preview = treeItem.querySelector(".annotationItemPreview");
    const date = treeItem.querySelector(".annotationItemDate");
    const button = treeItem.querySelector(".annotationItemButton");

    if (preview) {
      preview.textContent = this._getPreviewText(annotation);
    }
    if (date) {
      this._setAnnotationDate(date, annotation);
    }
    if (button && preview) {
      button.title = preview.textContent;
    }
  }

  _queueEditedAnnotationRefresh() {
    if (!this._editingAnnotationId || this._commentRefreshTimeoutId !== null) {
      return;
    }

    this._commentRefreshTimeoutId = window.setTimeout(() => {
      this._commentRefreshTimeoutId = null;
      if (!this._editingAnnotationId) {
        return;
      }
      this._refreshAnnotationRow(this._editingAnnotationId);
      this._editingAnnotationId = null;
    }, 0);
  }

  _getEditablePopup(editableAnnotation) {
    return (
      editableAnnotation?.extraPopupElement?.popup ||
      editableAnnotation?.popup ||
      null
    );
  }

  _getEditableAnnotation(annotation) {
    return (
      this.pdfViewer
        .getPageView(annotation.pageIndex)
        ?.annotationLayer?.annotationLayer?.getEditableAnnotation(
          annotation.id
        ) || null
    );
  }

  _getCommentManager(annotation) {
    return (
      this.pdfViewer.getPageView(annotation.pageIndex)?.annotationLayer
        ?.annotationLayer?._commentManager || null
    );
  }

  _createFallbackCommentEditor(editableAnnotation) {
    const commentButtonPosition = editableAnnotation.commentButtonPosition;
    if (!commentButtonPosition) {
      return null;
    }

    let commentPopupPosition = editableAnnotation._normalizePoint([
      ...commentButtonPosition,
    ]);
    return {
      getData() {
        const { richText, color, opacity, creationDate, modificationDate } =
          editableAnnotation.commentData;
        return {
          contentsObj: { str: this.comment },
          richText,
          color,
          opacity,
          creationDate,
          modificationDate,
        };
      },

      focusCommentButton() {
        setTimeout(() => {
          editableAnnotation.container?.focus();
        }, 0);
      },

      get parentBoundingClientRect() {
        return editableAnnotation.layer.getBoundingClientRect();
      },

      get commentPopupPosition() {
        return commentPopupPosition;
      },

      set commentPopupPosition(position) {
        commentPopupPosition = position;
      },

      hasDefaultPopupPosition() {
        return true;
      },

      get commentButtonWidth() {
        const { width } = editableAnnotation.layer.getBoundingClientRect();
        return width ? Math.min(32 / width, 0.12) : 0.04;
      },

      get comment() {
        return editableAnnotation.commentText;
      },

      set comment(text) {
        const nextText = typeof text === "string" ? text : "";
        if (nextText === editableAnnotation.commentText) {
          return;
        }

        editableAnnotation.commentText = nextText;
        editableAnnotation.updateEdited({
          popup: {
            date: new Date(),
            deleted: !nextText,
            text: nextText,
          },
        });
      },
    };
  }

  _createStorageBackedCommentEditor(annotation, treeItem) {
    const pageView = this.pdfViewer.getPageView(annotation.pageIndex);
    const pageElement = pageView?.div;
    const viewport = pageView?.viewport;
    const annotationStorage = this.pdfViewer.pdfDocument?.annotationStorage;
    if (!pageElement || !viewport || !annotationStorage) {
      return null;
    }

    const commentButton =
      treeItem?.querySelector(".annotationItemEditButton") ||
      treeItem?.querySelector(".annotationItemButton");
    const [anchorX, anchorY] = this._getStorageEditorAnchor(annotation, viewport);
    if (!Number.isFinite(anchorX) || !Number.isFinite(anchorY)) {
      return null;
    }

    const self = this;
    let commentPopupPosition = [anchorX, anchorY];
    return {
      getData() {
        const storedComment = self._getStoredCommentState(annotation);
        const text = storedComment?.hasOverride
          ? storedComment.text
          : toText(annotation.contentsObj) ||
            toText(annotation.contents) ||
            "";
        return {
          contentsObj: {
            str: text,
          },
          color: annotation.color,
          opacity: annotation.opacity,
          creationDate: annotation.creationDate,
          modificationDate:
            storedComment?.date ||
            annotation.modificationDate ||
            annotation.creationDate,
        };
      },

      focusCommentButton() {
        (commentButton || treeItem?.querySelector(".annotationItemButton"))?.focus();
      },

      get parentBoundingClientRect() {
        return pageElement.getBoundingClientRect();
      },

      get commentPopupPosition() {
        return commentPopupPosition;
      },

      set commentPopupPosition(position) {
        commentPopupPosition = position;
      },

      hasDefaultPopupPosition() {
        return true;
      },

      get commentButtonWidth() {
        const parentRect = pageElement.getBoundingClientRect();
        const buttonRect = commentButton?.getBoundingClientRect();
        return parentRect.width && buttonRect
          ? Math.min(buttonRect.width / parentRect.width, 0.14)
          : 0.05;
      },

      set comment(text) {
        const nextText = typeof text === "string" ? text : "";
        const modificationDate = new Date();
        const popup = {
          deleted: !nextText,
          contents: nextText || "",
        };
        if (!annotationStorage.updateEditor(annotation.id, { popup })) {
          annotationStorage.setValue(`${ANNOTATION_EDITOR_PREFIX}${annotation.id}`, {
            id: annotation.id,
            annotationType: annotation.annotationType,
            page: pageView.pdfPage,
            popup,
            popupRef: annotation.popupRef,
            modificationDate,
          });
        }
        self._syncAnnotationLayerComment(annotation, {
          date: modificationDate,
          deleted: popup.deleted,
          text: popup.contents,
        });
        self._refreshAnnotationRow(annotation.id);
      },
    };
  }

  _syncAnnotationLayerComment(annotation, popup) {
    const annotationLayer =
      this.pdfViewer.getPageView(annotation.pageIndex)?.annotationLayer
        ?.annotationLayer || null;
    const annotationElement = annotationLayer?.getAnnotation(annotation.id);
    if (!annotationElement) {
      return;
    }
    annotationElement.updateEdited({ popup });
  }

  _getStorageEditorAnchor(annotation, viewport) {
    const rect = annotation.rect;
    if (!Array.isArray(rect) || rect.length < 4) {
      return [NaN, NaN];
    }
    const [viewportX, viewportY] = viewport.convertToViewportPoint(rect[2], rect[3]);
    return [
      clamp(viewportX / viewport.width, 0.02, 0.98),
      clamp(viewportY / viewport.height, 0.02, 0.98),
    ];
  }

  async _waitForEditableAnnotation(annotation) {
    for (let remainingFrames = 0; remainingFrames < 60; remainingFrames++) {
      const editableAnnotation = this._getEditableAnnotation(annotation);
      if (editableAnnotation) {
        return editableAnnotation;
      }
      await new Promise(resolve => {
        window.requestAnimationFrame(resolve);
      });
    }
    return null;
  }

  _getSidebarAnchorPoint(overlayRect, annotationId) {
    let treeItem = this._currentTreeItem;
    if (
      !treeItem?.isConnected ||
      !treeItem.querySelector(".annotationItemButton")
    ) {
      treeItem = this._annotationRows.get(annotationId) || null;
    }
    const button = treeItem?.querySelector(".annotationItemButton");
    if (!button || button.offsetParent === null) {
      return null;
    }

    const buttonRect = button.getBoundingClientRect();
    if (!buttonRect.width || !buttonRect.height) {
      return null;
    }
    const x = this._isLTR
      ? buttonRect.right - overlayRect.left - 10
      : buttonRect.left - overlayRect.left + 10;
    const y = buttonRect.top - overlayRect.top + buttonRect.height / 2;
    return { x, y };
  }

  _hidePointer() {
    if (this._pointerSyncId) {
      window.cancelAnimationFrame(this._pointerSyncId);
      this._pointerSyncId = 0;
    }
    this._setHighlightedAnnotationElement(null);
    this._pointerOverlay?.classList.add("hidden");
    this._pointerOverlay?.classList.remove("offscreen");
  }
}

export { PDFAnnotationViewer };

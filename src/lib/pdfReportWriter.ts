import type { PDFDocument } from 'pdf-lib';
import { drawLogo, logoWidth, PdfPainter, REPORT_LOGO_HEIGHT, type ReportFonts } from './pdfText';
import type { ExportContext } from './exportLanguage';
import type { StirrupShapeCard } from './structuralPdfLayout';
import { placeStirrupPdfDimensions } from './stirrupPdfDimensions';

/*
 * The paginated vector writer every quantity report flows through (plan, project and their
 * structural sections): one header per page, section headings, tables, the hierarchical quantity
 * schedule and notes, with a new page whenever one fills up.
 */

const PAGE_W = 1600;
const PAGE_H = 1132;
const MARGIN = 40;
const ROW_H = 30;

// Same palette as the other exports.
const C_HEADER = '#1F4E79';
const C_ZEBRA_A = '#EBF5FB';
const C_ZEBRA_B = '#FDFEFE';
const C_TOTAL = '#D6E4F0';
const C_BORDER = '#E2E8F0';

export interface TableRow {
  cells: string[];
  bg?: string;
  bold?: boolean;
}

export interface MatrixCell {
  main: string;
  sub?: string;
  color?: string;
}

export interface MatrixRow {
  cells: MatrixCell[];
  total?: boolean;
  bg?: string;
}

/**
 * A row of the hierarchical quantity schedule: a work category with its total, then what divides
 * that same total — its types and its apartments / rooms — indented under it. Cells: label, net,
 * unit, waste, to order, details.
 */
export interface ScheduleRow {
  cells: string[];
  kind: 'category' | 'group' | 'label' | 'type' | 'room';
  /** Indentation steps of the label (0 = flush). */
  indent?: number;
  /** Text colour of the figures (e.g. a warning for "not calibrated"). */
  color?: string;
}

const SCHEDULE_STYLE: Record<ScheduleRow['kind'], { h: number; bg: string | null; size: number; bold: boolean; label: string }> = {
  category: { h: 30, bg: C_TOTAL, size: 12.5, bold: true, label: '#0f172a' },
  group: { h: 25, bg: '#EEF3F8', size: 11.5, bold: true, label: '#1e293b' },
  label: { h: 20, bg: null, size: 10, bold: true, label: '#64748B' },
  type: { h: 25, bg: '#F7FAFD', size: 11.5, bold: false, label: '#1F4E79' },
  room: { h: 25, bg: null, size: 11.5, bold: false, label: '#1e293b' },
};


/** Paginated vector writer: section titles and tables, a new page whenever one fills up. */
export class ReportWriter {
  private pt!: PdfPainter;
  private y = 0;
  private doc: PDFDocument;
  private fonts: ReportFonts;
  private title: string;
  private subtitle: string;
  private x: ExportContext;
  /** Where lines of text and table rows begin: the right margin for RTL, the left for LTR. */
  private startX: number;
  private sign: 1 | -1;
  /**
   * A heading waits until the content under it is placed, so it always lands on the same page as
   * that content — never alone at the bottom of a page.
   */
  private pending: { title: string; minimumRows: number } | null = null;

  constructor(doc: PDFDocument, fonts: ReportFonts, title: string, subtitle: string, x: ExportContext) {
    this.x = x;
    this.startX = x.rtl ? PAGE_W - MARGIN : MARGIN;
    this.sign = x.rtl ? -1 : 1;
    this.doc = doc;
    this.fonts = fonts;
    this.title = title;
    this.subtitle = subtitle;
    this.newPage();
  }

  /** Continues on a fresh page — e.g. after image pages were added to the document in between. */
  startPage() {
    this.newPage();
  }

  /** Moves to a new page unless `height` (in points) still fits on this one. */
  keep(height: number) {
    if (this.y + height > PAGE_H - MARGIN) this.newPage();
  }

  private newPage() {
    this.pt = new PdfPainter(this.doc.addPage([PAGE_W, PAGE_H]), this.fonts, this.x.direction);
    this.pt.fillText(this.title, this.startX, 40, { size: 20, bold: true, color: '#0f172a', maxWidth: PAGE_W - MARGIN * 2 - logoWidth(REPORT_LOGO_HEIGHT) - 24 });
    this.pt.fillText(this.subtitle, this.startX, 60, { size: 12, color: '#8b8f99' });
    drawLogo(this.pt, this.x.rtl ? MARGIN : PAGE_W - MARGIN - logoWidth(REPORT_LOGO_HEIGHT), 28, REPORT_LOGO_HEIGHT);
    this.y = 84;
  }

  private ensure(rows: number) {
    if (this.y + rows * ROW_H > PAGE_H - MARGIN) this.newPage();
  }

  private drawCells(cells: string[], widths: number[], bg: string, color: string, bold: boolean, columnSeparators = false) {
    const usable = PAGE_W - MARGIN * 2;
    this.pt.fillRect(MARGIN, this.y, usable, ROW_H, bg);
    this.pt.strokeRect(MARGIN, this.y, usable, ROW_H, C_BORDER);
    let edge = this.startX;
    cells.forEach((cell, i) => {
      const w = widths[i] ?? 0;
      if (columnSeparators && i > 0) {
        // Match the Finishes table's subtle body and header divider treatment.
        this.pt.line(edge, this.y, edge, this.y + ROW_H, bg === C_HEADER ? '#4B739A' : C_BORDER, 1);
      }
      this.pt.fillText(cell, edge + (this.sign * w) / 2, this.y + ROW_H / 2 + 4, { size: 12, bold, color, align: 'center', maxWidth: w - 6 });
      edge += this.sign * w;
    });
    this.y += ROW_H;
  }

  section(title: string, minimumRows = 3) {
    this.flush(0);
    this.pending = { title, minimumRows };
  }

  /** Draws a waiting heading, first moving to a new page when it and `blockHeight` would not fit here. */
  private flush(blockHeight: number) {
    const heading = this.pending;
    if (!heading) return;
    this.pending = null;
    const limit = PAGE_H - MARGIN;
    const HEADING_H = 40;
    const need = Math.max(heading.minimumRows * ROW_H, blockHeight);
    const fitsFresh = 84 + HEADING_H + need <= limit;
    // Move the whole block when it fits on a fresh page; a longer one moves only when not even its first rows fit.
    if (this.y + HEADING_H + (fitsFresh ? need : heading.minimumRows * ROW_H) > limit) this.newPage();
    this.drawHeading(heading.title);
  }

  private drawHeading(title: string) {
    this.y += 10;
    this.pt.fillText(title, this.startX, this.y + 16, { size: 15, bold: true, color: '#0f172a' });
    // A short accent rule under the heading: the report's sections read at a glance.
    this.pt.line(this.startX, this.y + 23, this.startX + this.sign * 48, this.y + 23, C_HEADER, 2);
    this.y += 30;
  }

  /** Keeps a short block together: when it does not fit here but fits on a fresh page, it moves there. */
  private keepTogether(height: number) {
    const limit = PAGE_H - MARGIN;
    if (this.y + height > limit && 84 + height <= limit) this.newPage();
  }

  /** One muted line of key facts under a heading (rooms, sheets, status…). */
  facts(text: string) {
    // Facts sit under their heading together with the start of what follows.
    this.flush(4 * ROW_H);
    this.ensure(1);
    this.pt.fillText(text, this.startX, this.y + 12, { size: 11.5, color: '#64748B', maxWidth: PAGE_W - MARGIN * 2 });
    this.y += 22;
  }

  /**
   * The hierarchical quantity schedule. The label column reads from the reading start with its
   * indentation, figures are centred, details are small and muted. On a page break the column header
   * and the current category row (marked as continued) are repeated.
   */
  schedule(headers: string[], weights: number[], rows: ScheduleRow[], continued: string) {
    const usable = PAGE_W - MARGIN * 2;
    const total = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => (usable * w) / total);
    const last = widths.length - 1;
    const header = () => this.drawCells(headers, widths, C_HEADER, '#ffffff', true, true);
    let category: ScheduleRow | null = null;
    let zebra = 0;
    this.flush(4 * ROW_H);
    const draw = (row: ScheduleRow) => {
      const style = SCHEDULE_STYLE[row.kind];
      const h = style.h;
      const bg = style.bg ?? (zebra++ % 2 === 0 ? '#FFFFFF' : '#F8FAFC');
      this.pt.fillRect(MARGIN, this.y, usable, h, bg);
      this.pt.line(MARGIN, this.y + h, PAGE_W - MARGIN, this.y + h, C_BORDER);
      if (row.kind === 'category') this.pt.line(MARGIN, this.y, PAGE_W - MARGIN, this.y, '#B4C2D0');
      const baseline = this.y + h / 2 + 4;
      let edge = this.startX;
      row.cells.forEach((cell, i) => {
        const w = widths[i] ?? 0;
        if (i === 0) {
          const indent = (row.indent ?? 0) * 18;
          this.pt.fillText(cell, edge + this.sign * (8 + indent), baseline, { size: style.size, bold: style.bold, color: style.label, maxWidth: w - 12 - indent });
        } else if (i === last) {
          this.pt.fillText(cell, edge + this.sign * 8, baseline, { size: 10, color: row.kind === 'category' ? '#334155' : '#64748B', maxWidth: w - 12 });
        } else if (cell) {
          this.pt.fillText(cell, edge + (this.sign * w) / 2, baseline, { size: style.size, bold: row.kind === 'category' || (row.kind === 'group' && i !== 2), color: row.color ?? '#1e293b', align: 'center', maxWidth: w - 6 });
        }
        edge += this.sign * w;
      });
      this.y += h;
    };
    this.ensure(3);
    header();
    let group: ScheduleRow | null = null;
    const asContinued = (row: ScheduleRow): ScheduleRow => ({ ...row, cells: [`${row.cells[0]} ${continued}`, ...row.cells.slice(1)] });
    rows.forEach((row) => {
      const h = SCHEDULE_STYLE[row.kind].h;
      // Headings of the hierarchy (category, apartment, "by type"/"by room") never end a page alone.
      const need = row.kind === 'category' ? h + 2 * SCHEDULE_STYLE.room.h : row.kind === 'room' || row.kind === 'type' ? h : h + SCHEDULE_STYLE.room.h;
      if (this.y + need > PAGE_H - MARGIN) {
        this.newPage();
        header();
        // Where the rows continue, so does their context: the category, and the apartment they belong to.
        if (category && row.kind !== 'category') draw(asContinued(category));
        if (group && row.kind === 'room') draw(asContinued(group));
      }
      if (row.kind === 'category') {
        category = row;
        group = null;
        zebra = 0;
        if (this.y > 84 + ROW_H + 1) this.y += 4;
      } else if (row.kind === 'group') group = row;
      else if (row.kind === 'label') group = null;
      draw(row);
    });
    this.y += ROW_H * 0.5;
  }

  table(headers: string[], weights: number[], rows: TableRow[], columnSeparators = false) {
    const usable = PAGE_W - MARGIN * 2;
    const total = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => (usable * w) / total);
    const header = () => this.drawCells(headers, widths, C_HEADER, '#ffffff', true, columnSeparators);
    // A short table (and its heading) stays on one page rather than leaving a lone total row behind.
    const block = (rows.length + 1) * ROW_H;
    if (this.pending) this.flush(block);
    else this.keepTogether(block);
    this.ensure(2);
    header();
    rows.forEach((row, i) => {
      if (this.y + ROW_H > PAGE_H - MARGIN) {
        this.newPage();
        header(); // repeat the header on every page the table continues onto
      }
      this.drawCells(row.cells, widths, row.bg ?? (i % 2 === 0 ? C_ZEBRA_A : C_ZEBRA_B), '#1e293b', !!row.bold, columnSeparators);
    });
    this.y += ROW_H * 0.5;
  }

  /** The original finishes matrix: paired quantity columns, two-line cells and one total row. */
  matrix(identity: string[], groups: string[], subheaders: string[], rows: MatrixRow[], details?: { title: string; headers: string[] }, identityLayout = { weights: [80, 220], labelColumn: 1 }) {
    const usable = PAGE_W - MARGIN * 2;
    const weights = [...identityLayout.weights, ...groups.flatMap(() => [88, 88]), ...(details ? [140, 180] : [])];
    const sum = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map(w => usable * w / sum);
    const edges = widths.map((_, i) => this.startX + this.sign * widths.slice(0, i).reduce((a, b) => a + b, 0));
    const headerHeight = 54;
    const textColumn = (i: number) => i === identityLayout.labelColumn || !!details && i >= widths.length - 2;
    const wrapName = (name: string, i: number): string[] => {
      const width = widths[i] - 16;
      const bold = i === identityLayout.labelColumn;
      if (this.pt.measure(name, 12, bold) <= width) return [name];
      const words = name.split(/\s+/);
      let first = words.shift() ?? '';
      while (words.length && this.pt.measure(`${first} ${words[0]}`, 12, bold) <= width) first += ` ${words.shift()}`;
      let second = words.join(' ');
      while (second.length > 1 && this.pt.measure(`${second}…`, 12, bold) > width) second = second.slice(0, -1).trimEnd();
      if (second !== words.join(' ')) second += '…';
      return second ? [first, second] : [first];
    };
    const cellLines = rows.map(row => row.cells.map((cell, i) => textColumn(i) ? wrapName(cell.main, i) : [cell.main]));
    const heights = rows.map((_, i) => cellLines[i].some(lines => lines.length > 1) ? 58 : 44);
    const header = () => {
      this.pt.fillRect(MARGIN, this.y, usable, headerHeight, C_HEADER);
      const label = (text: string, i: number, width: number, baseline: number, size = 12) =>
        this.pt.fillText(text, edges[i] + this.sign * width / 2, baseline, { size, bold: true, color: '#ffffff', align: 'center', maxWidth: width - 12 });
      identity.forEach((name, i) => label(name, i, widths[i], this.y + 32));
      groups.forEach((name, g) => {
        const i = 2 + g * 2;
        label(name, i, widths[i] + widths[i + 1], this.y + 19);
        subheaders.forEach((name, j) => label(name, i + j, widths[i + j], this.y + 44, 11));
      });
      if (details) {
        const i = widths.length - 2;
        label(details.title, i, widths[i] + widths[i + 1], this.y + 19);
        details.headers.forEach((name, j) => label(name, i + j, widths[i + j], this.y + 44, 11));
      }
      this.pt.line(edges[2], this.y + 28, this.startX + this.sign * usable, this.y + 28, '#4B739A');
      widths.forEach((_, i) => {
        if (i > 0) this.pt.line(edges[i], this.y + (i > 2 && i % 2 === 1 ? 28 : 0), edges[i], this.y + headerHeight, '#4B739A');
      });
      this.y += headerHeight;
    };
    this.flush(headerHeight + heights.slice(0, 3).reduce((a, b) => a + b, 0));
    this.keepTogether(headerHeight + heights.reduce((a, b) => a + b, 0));
    this.keep(headerHeight + heights.slice(0, 2).reduce((a, b) => a + b, 0));
    header();
    rows.forEach((row, r) => {
      const rowHeight = heights[r];
      // Keep the last room and its integrated summary together.
      const need = rowHeight + (rows[r + 1]?.total ? heights[r + 1] : 0);
      if (this.y + need > PAGE_H - MARGIN) { this.newPage(); header(); }
      const bg = row.total ? C_TOTAL : row.bg ?? (r % 2 === 0 ? C_ZEBRA_A : C_ZEBRA_B);
      this.pt.fillRect(MARGIN, this.y, usable, rowHeight, bg);
      this.pt.strokeRect(MARGIN, this.y, usable, rowHeight, C_BORDER);
      row.cells.forEach((cell, i) => {
        const w = widths[i];
        if (i > 0) this.pt.line(edges[i], this.y, edges[i], this.y + rowHeight, i % 2 === 0 ? '#B4C2D0' : C_BORDER);
        const text = textColumn(i);
        const cx = edges[i] + this.sign * (text ? 8 : w / 2);
        const align = text ? this.x.rtl ? 'right' : 'left' : 'center';
        const lines = cellLines[r][i];
        lines.forEach((line, l) => this.pt.fillText(line, cx, this.y + (cell.sub || lines.length > 1 ? 18 + l * 15 : rowHeight / 2 + 5), { size: 12, bold: !!row.total || i === identityLayout.labelColumn, color: cell.color ?? '#1e293b', align, maxWidth: w - 12 }));
        if (cell.sub) this.pt.fillText(cell.sub, cx, this.y + rowHeight - 9, { size: 9.5, color: cell.color ?? '#64748B', align, maxWidth: w - 12 });
      });
      this.y += rowHeight;
    });
    this.y += 15;
  }

  shapeCard(card: StirrupShapeCard) {
    this.flush(4 * ROW_H);
    const height = Math.max(108, 44 + (Math.ceil(card.details.length / 2) - 1) * 22 + 32);
    // Keep the compact card with the following placement header and first row.
    this.ensure((height + 4 + ROW_H * 2) / ROW_H);
    const top = this.y;
    const width = Math.min(PAGE_W - MARGIN * 2, 780);
    const left = this.x.rtl ? PAGE_W - MARGIN - width : MARGIN;
    const diagramX = this.x.rtl ? left + width - 112 : left + 8;
    this.pt.strokeRect(left, top, width, height, C_BORDER);
    const points = card.shape.points;
    const minX = points.length ? Math.min(...points.map((point) => point.x)) : 0;
    const maxX = points.length ? Math.max(...points.map((point) => point.x)) : 0;
    const minY = points.length ? Math.min(...points.map((point) => point.y)) : 0;
    const maxY = points.length ? Math.max(...points.map((point) => point.y)) : 0;
    const scale = 64 / Math.max(maxX - minX, maxY - minY, 1);
    // A fixed visual area, centred without ever mirroring the saved geometry in RTL.
    const screenX = (x: number) => diagramX + 52 + (x - (minX + maxX) / 2) * scale;
    const screenY = (y: number) => top + (height - 14) / 2 + (y - (minY + maxY) / 2) * scale;
    for (const segment of card.shape.segments) {
      this.pt.line(screenX(segment.normalizedStart.x), screenY(segment.normalizedStart.y),
        screenX(segment.normalizedEnd.x), screenY(segment.normalizedEnd.y), '#c2410c', 1.5);
    }
    // Keep the existing annotation density, but separate nearby labels using measured boxes.
    const dimensions = card.shape.segments.slice(0, 6).map((segment) => ({
      start: { x: screenX(segment.normalizedStart.x), y: screenY(segment.normalizedStart.y) },
      end: { x: screenX(segment.normalizedEnd.x), y: screenY(segment.normalizedEnd.y) },
      text: this.x.number(Math.round(segment.lengthM * 1000) / 10),
    }));
    const labels = placeStirrupPdfDimensions(dimensions,
      { left: diagramX, top: top + 4, width: 104, height: height - 20 },
      (text) => this.pt.measure(text, 8, false, 'ltr'));
    for (const label of labels) {
      if (label.leader) {
        // Stop at the label edge so the connector never runs through its text.
        const dx = label.midpoint.x - label.x, dy = label.midpoint.y - label.y;
        const edge = 1 / Math.max(Math.abs(dx) / (label.width / 2 + 2), Math.abs(dy) / (label.height / 2 + 2));
        this.pt.line(label.midpoint.x, label.midpoint.y, label.x + dx * edge, label.y + dy * edge, '#a8a29e', 0.5);
      }
      this.pt.fillText(label.text, label.x, label.y + 3,
        { size: 8, direction: 'ltr', align: 'center', color: '#78716c', maxWidth: label.width });
    }
    this.pt.fillText(this.x.t('units.cm'), diagramX + 52, top + height - 7,
      { size: 8, direction: 'ltr', align: 'center', color: '#78716c' });
    const textWidth = width - 140;
    const textX = this.x.rtl ? diagramX - 12 : left + 128;
    this.pt.fillText(card.title, textX, top + 21, { size: 14, bold: true, maxWidth: textWidth });
    const columnWidth = textWidth / 2;
    card.details.forEach((detail, index) => this.pt.fillText(detail,
      textX + this.sign * (index % 2) * columnWidth, top + 44 + Math.floor(index / 2) * 22,
      { size: 11, maxWidth: columnWidth - 12 }));
    this.y += height + 4;
  }

  note(text: string) {
    this.flush(ROW_H);
    this.ensure(1);
    this.pt.fillText(text, this.startX, this.y + 16, { size: 12, bold: true, color: '#92400e' });
    this.y += ROW_H;
  }
}

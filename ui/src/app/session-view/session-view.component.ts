import { AfterViewInit, Component, ElementRef, OnInit, QueryList, Renderer2, ViewChild, ViewChildren } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { Title } from '@angular/platform-browser';
import { ApiService } from 'src/app/services/api.service';

import * as monaco from 'monaco-editor';
import { GoogleAnalyticsService } from 'src/app/services/google-analytics.service';
import { ClipboardService } from 'ngx-clipboard';
import { ToastService } from 'src/app/services/toast.service';
import { LanguageUpdate, MonacoEditorComponent, Mode } from 'src/app/monaco-editor/monaco-editor.component';

@Component({
  selector: 'app-session-view',
  templateUrl: './session-view.component.html',
  styleUrls: ['./session-view.component.scss'],
})
export class SessionViewComponent implements OnInit, AfterViewInit {

  readonly codeEditorMinHeight = 200;
  readonly bottomBarMinHeight = 300;

  EditorMode = Mode;

  sessionInvalid = false;
  showBottomBar = false;
  selectedLanguage!: string;
  supportsFormatting: boolean;

  languages = new Array("plaintext", "python", "java", "go", "cpp", "c", "r");

  hintsEnabled = true;

  @ViewChildren(MonacoEditorComponent)
  monacoEditorComponents!: QueryList<MonacoEditorComponent>;

  @ViewChild('contentContainer')
  contentContainer!: ElementRef<HTMLDivElement>;

  @ViewChild('topBarRow')
  topBarRow!: ElementRef<HTMLDivElement>;

  @ViewChild('editorRow')
  editorRow!: ElementRef<HTMLDivElement>;

  @ViewChild('bottomBarRow')
  bottomBarRow!: ElementRef<HTMLDivElement>;

  lastClientY: number = 0;
  isDragging: boolean = false;
  editorHeight: number = 0;
  bottomBarHeight: number = 0;
  fullHeight: number = 0;
  bottomBarCollapsed: boolean = false;
  resizeHandleCursor = 'ns-resize';

  stdoutActive = true;
  stderrActive = false;

  outputEditorMode: Mode = Mode.Stdout;

  constructor(
    private route: ActivatedRoute,
    private titleService: Title,
    private apiService: ApiService,
    private googleAnalyticsService: GoogleAnalyticsService,
    private clipboardService: ClipboardService,
    private toastService: ToastService,
    private renderer: Renderer2) {
    const enabledString = localStorage.getItem('hints_enabled');
    if (enabledString === 'disabled') {
      this.hintsEnabled = false;
    } else {
      this.hintsEnabled = true;
    }
    this.supportsFormatting = false;
  }

  ngOnInit(): void {
    this.route.params.subscribe(params => {
      this.apiService.StartSession(params.session_id);
      this.titleService.setTitle('coCoder ' + params.session_id.substring(params.session_id.length - 6));
    })
  }

  ngAfterViewInit(): void {
    this.onResize();
  }

  codeEditor(): MonacoEditorComponent {
    return this.monacoEditorComponents.find(c => c.mode == Mode.Code)!;
  }

  inputEditor(): MonacoEditorComponent | undefined {
    return this.monacoEditorComponents.find(c => c.mode == Mode.Stdin);
  }

  outputEditor(): MonacoEditorComponent | undefined {
    return this.monacoEditorComponents.find(c => c.mode == Mode.Stdout);
  }

  onResize() {
    this.fullHeight = this.contentContainer.nativeElement.offsetHeight - this.topBarRow.nativeElement.offsetHeight - 30;
    this.bottomBarHeight = this.showBottomBar ? this.bottomBarMinHeight : 0;
    this.editorHeight = this.fullHeight - this.bottomBarHeight;

    this.applyCustomHeights();
  }

  applyCustomHeights() {
    this.renderer.setStyle(this.bottomBarRow.nativeElement, 'height', `${this.bottomBarHeight}px`);
    this.renderer.setStyle(this.editorRow.nativeElement, 'height', `${this.editorHeight}px`);

    this.refreshEditors();
  }

  refreshEditors() {
    this.codeEditor().OnResize();
    this.inputEditor()?.OnResize();
    this.outputEditor()?.OnResize();

    // There's a delay between resizing the parent from the renderer and monaco-editor picking this change up.
    // This 10ms sleep fixes the rendering of the parent.
    setTimeout(() => {
      this.codeEditor().OnResize();
      this.inputEditor()?.OnResize();
      this.outputEditor()?.OnResize();
    }, 10);
  }

  otherLanguages(): string[] {
    return monaco.languages.getLanguages().map((v, _) => v.id).filter(v => !this.languages.includes(v));
  }

  onLanguageChange(val: string) {
    this.selectedLanguage = val;
    this.apiService.updateLanguage(val);
    this.codeEditor().SetLanguage(val);
    this.googleAnalyticsService.event('language_change', 'engagement', 'top_bar', val);
  }

  downloadButtonClicked(): void {
    this.codeEditor().saveContent();
    this.googleAnalyticsService.event('download_content', 'engagement', 'top_bar');
  }

  shareButtonClicked(): void {
    this.clipboardService.copy(window.location.href);
    this.toastService.show("", "Copied session URL to clipboard");
    this.googleAnalyticsService.event('share_button', 'engagement', 'top_bar');
  }

  zoomInButtonClicked(): void {
    this.codeEditor().updateFontSize(1);
    this.inputEditor()?.updateFontSize(1);
    this.outputEditor()?.updateFontSize(1);
    this.googleAnalyticsService.event('zoom', 'engagement', 'top_bar', 'increase');
  }

  zoomOutButtonClicked(): void {
    this.codeEditor().updateFontSize(-1);
    this.inputEditor()?.updateFontSize(-1);
    this.outputEditor()?.updateFontSize(-1);
    this.googleAnalyticsService.event('zoom', 'engagement', 'top_bar', 'decrease');
  }

  notificationsTitle(): string {
    return this.hintsEnabled ? 'Click to disable hints' : 'Click to enable hints';
  }

  notificationsButtonClicked(): void {
    this.hintsEnabled = !this.hintsEnabled;
    if (this.hintsEnabled)
      localStorage.setItem('hints_enabled', 'enabled');
    else
      localStorage.setItem('hints_enabled', 'disabled');
  }

  updateLanguage(ev: LanguageUpdate) {
    this.selectedLanguage = ev.language;
    this.supportsFormatting = ev.supportsFormatting;
    this.showBottomBar = ev.supportsExecution;

    this.onResize();
  }

  startDragging(ev: MouseEvent) {
    if (this.bottomBarCollapsed) {
      return;
    }
    this.isDragging = true;
    this.lastClientY = ev.clientY;
  }

  stopDragging() {
    this.isDragging = false;
  }

  keepDragging(ev: MouseEvent) {
    if (this.isDragging) {
      const diff = this.lastClientY - ev.clientY;
      this.lastClientY = ev.clientY;
      this.bottomBarHeight += diff;
      this.editorHeight -= diff;

      if (this.editorHeight < this.codeEditorMinHeight) {
        this.editorHeight = this.codeEditorMinHeight;
        this.bottomBarHeight = this.fullHeight - this.editorHeight;
      }
      if (this.bottomBarHeight < this.bottomBarMinHeight) {
        this.bottomBarHeight = this.bottomBarMinHeight;
        this.editorHeight = this.fullHeight - this.bottomBarHeight;
      }

      this.applyCustomHeights();

      this.inputEditor()!.OnResize();
      this.outputEditor()!.OnResize();
    }
  }

  toggleCollapse() {
    if (this.bottomBarCollapsed) {
      this.applyCustomHeights();
      this.resizeHandleCursor = 'ns-resize';
    } else {
      this.renderer.setStyle(this.bottomBarRow.nativeElement, 'height', `75px`);
      this.resizeHandleCursor = '';
      this.renderer.setStyle(this.editorRow.nativeElement, 'height', `${this.fullHeight - 75}px`);

      this.refreshEditors();
    }

    this.bottomBarCollapsed = !this.bottomBarCollapsed;
  }

  stdoutClicked() {
    this.stdoutActive = true;
    this.stderrActive = false;
  }

  stderrClicked() {
    this.stdoutActive = false;
    this.stderrActive = true;
  }

  runClicked() {
    this.outputEditor()!.SetText('test output');
  }
}


import { AfterViewInit, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { Subscription } from 'rxjs';
import { Title } from '@angular/platform-browser';
import { ApiService, GetSessionResponse } from '../api.service';
import { EditorService } from '../editor.service';
import * as monaco from 'monaco-editor';
import { ThemeService } from '../theme.service';
import { EditorControllerService } from '../editor-controller.service';

@Component({
  selector: 'app-session-view',
  templateUrl: './session-view.component.html',
  styleUrls: ['./session-view.component.scss'],
})
export class SessionViewComponent implements OnInit, OnDestroy {
  darkModeEnabled!: boolean;

  languageChangesSubscription?: Subscription;
  sessionSubscription?: Subscription;
  editsSubscription?: Subscription;

  lastBaseText = "";

  sessionInvalid = false;
  editorServiceInitialized = false;

  initialSessionPromise!: Promise<GetSessionResponse | null>;

  editorInitializedPromise: Promise<boolean>;
  editorInitializedResolve!: (val: boolean) => void;

  constructor(
    private route: ActivatedRoute,
    private cdRef: ChangeDetectorRef,
    private titleService: Title,
    private apiService: ApiService,
    private editorService: EditorService,
    private themeService: ThemeService,
    private editorControllerService: EditorControllerService) {
    this.darkModeEnabled = this.themeService.isDarkThemeEnabled();
    this.editorInitializedPromise = new Promise<boolean>((resolve, reject) => {
      this.editorInitializedResolve = resolve;
    });
  }

  ngOnInit(): void {
    this.route.params.subscribe(params => {
      this.apiService.SetSessionID(params.session_id);
      this.titleService.setTitle('coCoder ' + params.session_id.substring(params.session_id.length - 6));
    })

    this.initialSessionPromise = this.apiService.GetSession().then(data => {
      this.editorControllerService.setLanguage(data.Language);
      this.cdRef.detectChanges();
      return data;
    },
      err => {
        console.log("Failed to get session:", err);
        this.sessionInvalid = true;
        this.cdRef.detectChanges();
        return null;
      },
    );

    this.languageChangesSubscription = this.editorControllerService.languageChanges().subscribe(_ => {
      if (this.editorServiceInitialized) {
        this.updateSession();
      }
    });
  }

  ngOnDestroy() {
    this.sessionSubscription?.unsubscribe();
    this.editsSubscription?.unsubscribe();
    this.languageChangesSubscription?.unsubscribe();
  }

  selectedTheme(): string {
    return this.themeService.editorThemeName();
  }

  initializeEditorService() {
    this.initialSessionPromise.then(
      data => {
        if (data === null) {
          return;
        }
        this.editorService.SetText(data.Text);
        this.editorService.SetLanguage(data.Language);
        this.lastBaseText = data.Text;

        this.sessionSubscription = this.apiService.SessionObservable().subscribe({
          next: data => {
            if (data.Language)
              this.editorControllerService.setLanguage(data.Language);

            if (data.NewText !== this.editorService.Text()) {
              this.editorService.SetText(data.NewText!);
            }

            this.lastBaseText = data.NewText!;

            this.editorService.UpdateCursors(data.Users!);
          },
          error: err => {
            console.log("Failed to update session:", err);
          },
        });
      },
    );

    this.editsSubscription = this.editorService.editsObservable().subscribe({
      next: () => {
        this.updateSession();
      },
    });
  }

  onInit(editor: monaco.editor.IStandaloneCodeEditor) {
    this.editorService.SetEditor(editor);
    this.editorService.SetUserID(this.apiService.GetUserID());

    if (!this.editorServiceInitialized) {
      this.editorInitializedResolve(true);

      this.editorService.SetText('');
      this.editorServiceInitialized = true;
      this.initializeEditorService();
    }
  }

  editorInitialized(): Promise<boolean> {
    return this.editorInitializedPromise;
  }

  updateSession() {
    const newText = this.editorService.Text();
    this.apiService.UpdateSession(this.lastBaseText, newText, this.editorService.Position(), this.editorService.OtherUsers(), this.editorService.Selection());
    this.lastBaseText = newText;
  }

  editorCreateOptions() {
    return this.editorService.createOptions();
  }
}

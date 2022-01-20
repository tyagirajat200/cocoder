import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map, retry } from 'rxjs/operators';
import { environment } from '../environments/environment';
import { v4 as uuidv4 } from 'uuid';
import { CookieService } from 'ngx-cookie-service';

export type OtherUser = {
  ID: string
  CursorPos: number
}

export type EditResponse = {
  NewText: string
  CursorPos: number
  WasMerged: boolean
  Language: string
  OtherUsers: OtherUser[]
}

export type GetSessionResponse = {
  Text: string
  Language: string
}

type LanguageState = 'stable' | 'triggering' | 'triggered';

@Injectable({
  providedIn: 'root'
})
export class ApiService {

  languageState: LanguageState = 'stable';
  sessionID !: string;
  userID: string;

  constructor(
    private httpClient: HttpClient,
    private cookieService: CookieService,
  ) {
    this.userID = this.cookieService.get('user_id');
    if (this.userID == '') {
      this.userID = uuidv4();
      this.cookieService.set('user_id', this.userID, undefined, "/");
    }
  }

  SetSessionID(sessionID: string) {
    this.sessionID = sessionID;
  }

  UpdateSession(baseText: string, newText: string, cursorPos: number): Observable<EditResponse> {
    if (this.languageState == 'triggered')
      this.languageState = 'stable';

    const formData = new FormData();
    formData.append("BaseText", baseText);
    formData.append("NewText", newText);
    formData.append("CursorPos", cursorPos.toString());
    formData.append("UserID", this.userID);

    return this.httpClient.post<EditResponse>(environment.api + this.sessionID, formData).pipe(
      retry(3),
      map(data => {
        if (this.languageState != 'stable')
          data.Language = '';
        return data;
      }),
    );
  }

  GetSession(): Promise<GetSessionResponse> {
    return this.httpClient.get<GetSessionResponse>(environment.api + this.sessionID).pipe(
      retry(3)
    ).toPromise();
  }

  SetLanguage(language: string) {
    this.languageState = 'triggering';

    const formData = new FormData();
    formData.append("Language", language);
    this.httpClient.post(environment.api + this.sessionID + '/language', formData).pipe(
      retry(3)
    ).subscribe({
      error: (err) => { console.log("Failed to update session language:", err); },
      complete: () => { this.languageState = 'triggered'; },
    });
  }
}

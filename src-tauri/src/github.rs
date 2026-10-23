// GitHub for the desktop app: signing in through the device flow, the account, its repositories and creating one.
// The token stays on this side, in the system's credential store, and goes only to github.com and api.github.com,
// over HTTPS, following no redirects.

use crate::git::{message, Failure, Login};
use reqwest::header::{ACCEPT, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;

/// Gittin's OAuth App. Its client ID is public: the device flow needs no client secret.
const CLIENT_ID: &str = "Ov23liNFACFy3Ri2Hry1";
const DEVICE_CODE: &str = "https://github.com/login/device/code";
const ACCESS_TOKEN: &str = "https://github.com/login/oauth/access_token";
const API: &str = "https://api.github.com";

/// The signed-in account: its login, avatar address and the token's scopes.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Account {
    pub login: String,
    pub avatar: String,
    pub scopes: Vec<String>,
}

/// A sign-in as the credential store keeps it.
#[derive(Serialize, Deserialize, Clone)]
struct Signed {
    token: String,
    account: Account,
}

/// The code the sign-in dialog shows, where to enter it, and for how many seconds it lasts.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCode {
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
}

/// A sign-in under way: the code Gittin polls with, and how long to wait between polls.
#[derive(Clone, Debug, PartialEq)]
struct Pending {
    device_code: String,
    interval: u64,
}

/// How a sign-in ended. `remembered` is false when the token could only be kept in memory.
#[derive(Serialize, Debug, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Ended {
    SignedIn { account: Account, remembered: bool },
    Expired,
    Declined,
    Cancelled,
}

/// One of the account's repositories, for Clone's list.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Repository {
    pub full_name: String,
    pub clone_url: String,
    pub private: bool,
}

/// GitHub's answer to one poll for the token.
#[derive(Debug, PartialEq)]
enum Poll {
    Waiting,
    SlowDown,
    Expired,
    Declined,
    Token(String),
}

fn unreadable() -> Failure {
    message("GitHub's answer couldn't be read.")
}

/// GitHub's reason in an error answer from a sign-in endpoint.
fn sign_in_error(body: &str) -> Failure {
    #[derive(Deserialize)]
    struct Reply {
        error: Option<String>,
        error_description: Option<String>,
    }
    match serde_json::from_str::<Reply>(body) {
        Ok(Reply {
            error_description: Some(text),
            ..
        })
        | Ok(Reply {
            error: Some(text), ..
        }) => message(text),
        _ => unreadable(),
    }
}

fn code_reply(body: &str) -> Result<(DeviceCode, Pending), Failure> {
    #[derive(Deserialize)]
    struct Reply {
        device_code: String,
        user_code: String,
        verification_uri: String,
        expires_in: u64,
        interval: u64,
    }
    let reply: Reply = serde_json::from_str(body).map_err(|_| sign_in_error(body))?;
    Ok((
        DeviceCode {
            user_code: reply.user_code,
            verification_uri: reply.verification_uri,
            expires_in: reply.expires_in,
        },
        Pending {
            device_code: reply.device_code,
            interval: reply.interval,
        },
    ))
}

fn poll_reply(body: &str) -> Result<Poll, Failure> {
    #[derive(Deserialize)]
    struct Reply {
        access_token: Option<String>,
        error: Option<String>,
    }
    let reply: Reply = serde_json::from_str(body).map_err(|_| unreadable())?;
    Ok(match (reply.access_token, reply.error.as_deref()) {
        (Some(token), _) => Poll::Token(token),
        (_, Some("authorization_pending")) => Poll::Waiting,
        (_, Some("slow_down")) => Poll::SlowDown,
        // GitHub's docs name it both ways.
        (_, Some("expired_token" | "token_expired")) => Poll::Expired,
        (_, Some("access_denied")) => Poll::Declined,
        _ => return Err(sign_in_error(body)),
    })
}

/// The token's scopes, from GitHub's `X-OAuth-Scopes` header.
fn scopes(header: Option<&str>) -> Vec<String> {
    header
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|scope| !scope.is_empty())
        .map(str::to_string)
        .collect()
}

fn repositories_reply(body: &str) -> Result<Vec<Repository>, Failure> {
    #[derive(Deserialize)]
    struct Listed {
        full_name: String,
        clone_url: String,
        private: bool,
    }
    let listed: Vec<Listed> = serde_json::from_str(body).map_err(|_| unreadable())?;
    Ok(listed
        .into_iter()
        .map(|listed| Repository {
            full_name: listed.full_name,
            clone_url: listed.clone_url,
            private: listed.private,
        })
        .collect())
}

/// GitHub's reason for refusing an API request: its message, with its errors' details.
fn reason(status: u16, body: &str) -> String {
    #[derive(Deserialize)]
    struct Body {
        message: String,
        #[serde(default)]
        errors: Vec<Detail>,
    }
    #[derive(Deserialize)]
    struct Detail {
        message: Option<String>,
    }
    match serde_json::from_str::<Body>(body) {
        Ok(body) => {
            let details: Vec<String> = body
                .errors
                .into_iter()
                .filter_map(|detail| detail.message)
                .collect();
            if details.is_empty() {
                body.message
            } else {
                format!(
                    "{}: {}",
                    body.message.trim_end_matches('.'),
                    details.join("; ")
                )
            }
        }
        Err(_) => format!("GitHub answered {status}."),
    }
}

/// The HTTP client for GitHub. It follows no redirects, so the token goes nowhere but where it is sent.
fn client() -> Result<reqwest::Client, Failure> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("Gittin")
        .build()
        .map_err(|error| message(error.to_string()))
}

async fn send(request: reqwest::RequestBuilder) -> Result<reqwest::Response, Failure> {
    request.send().await.map_err(|error| {
        if error.is_connect() || error.is_timeout() {
            Failure::Offline
        } else {
            message(error.without_url().to_string())
        }
    })
}

/// Posts a form to one of GitHub's sign-in endpoints, asking for JSON.
async fn form(url: &str, body: String) -> Result<String, Failure> {
    let request = client()?
        .post(url)
        .header(ACCEPT, "application/json")
        .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(body);
    send(request).await?.text().await.map_err(|_| unreadable())
}

/// An API request with the token. A 401 means GitHub no longer accepts it.
async fn api(token: &str, request: reqwest::RequestBuilder) -> Result<reqwest::Response, Failure> {
    let request = request
        .bearer_auth(token)
        .header(ACCEPT, "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");
    let response = send(request).await?;
    let status = response.status();
    if status.is_success() {
        Ok(response)
    } else if status == reqwest::StatusCode::UNAUTHORIZED {
        Err(Failure::Refused)
    } else {
        Err(message(reason(
            status.as_u16(),
            &response.text().await.unwrap_or_default(),
        )))
    }
}

async fn user(token: &str) -> Result<Account, Failure> {
    #[derive(Deserialize)]
    struct User {
        login: String,
        avatar_url: String,
    }
    let response = api(token, client()?.get(format!("{API}/user"))).await?;
    let scopes = scopes(
        response
            .headers()
            .get("x-oauth-scopes")
            .and_then(|value| value.to_str().ok()),
    );
    let body = response.text().await.map_err(|_| unreadable())?;
    let user: User = serde_json::from_str(&body).map_err(|_| unreadable())?;
    Ok(Account {
        login: user.login,
        avatar: user.avatar_url,
        scopes,
    })
}

/// The sign-in, once per computer, and a sign-in under way.
#[derive(Default)]
pub struct GitHub {
    /// None until the credential store has been read.
    signed: Mutex<Option<Option<Signed>>>,
    pending: Mutex<Option<Pending>>,
}

impl GitHub {
    async fn signed(&self) -> Option<Signed> {
        if let Some(known) = self.signed.lock().unwrap().clone() {
            return known;
        }
        let stored = store::load().await;
        self.signed.lock().unwrap().get_or_insert(stored).clone()
    }

    pub async fn account(&self) -> Option<Account> {
        self.signed().await.map(|signed| signed.account)
    }

    /// The login and token git sends to GitHub.
    pub async fn login(&self) -> Option<Login> {
        self.signed().await.map(|signed| Login {
            login: signed.account.login,
            token: signed.token,
        })
    }

    async fn token(&self) -> Result<String, Failure> {
        self.signed()
            .await
            .map(|signed| signed.token)
            .ok_or(Failure::SignIn)
    }

    /// Forgets the token on this computer. GitHub's endpoints for revoking it need the client secret, which Gittin
    /// doesn't have.
    pub async fn sign_out(&self) {
        *self.signed.lock().unwrap() = Some(None);
        store::forget().await;
    }

    /// Forgets the sign-in when GitHub refused it.
    pub async fn checked<T>(&self, result: Result<T, Failure>) -> Result<T, Failure> {
        if matches!(result, Err(Failure::Refused)) {
            self.sign_out().await;
        }
        result
    }

    /// Starts a sign-in for `repo`, and `workflow` when asked.
    pub async fn device_code(&self, workflow: bool) -> Result<DeviceCode, Failure> {
        let scope = if workflow { "repo+workflow" } else { "repo" };
        let reply = form(DEVICE_CODE, format!("client_id={CLIENT_ID}&scope={scope}")).await?;
        let (shown, pending) = code_reply(&reply)?;
        *self.pending.lock().unwrap() = Some(pending);
        Ok(shown)
    }

    /// Waits for the writer to authorise the code, polling at GitHub's interval.
    pub async fn wait(&self) -> Result<Ended, Failure> {
        let Some(mut pending) = self.pending.lock().unwrap().clone() else {
            return Ok(Ended::Cancelled);
        };
        loop {
            tokio::time::sleep(Duration::from_secs(pending.interval)).await;
            let current = self
                .pending
                .lock()
                .unwrap()
                .as_ref()
                .map(|now| now.device_code.clone());
            if current.as_deref() != Some(pending.device_code.as_str()) {
                return Ok(Ended::Cancelled);
            }
            let body = format!(
                "client_id={CLIENT_ID}&device_code={}&grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code",
                pending.device_code
            );
            match poll_reply(&form(ACCESS_TOKEN, body).await?)? {
                Poll::Waiting => {}
                Poll::SlowDown => pending.interval += 5,
                Poll::Expired => return Ok(Ended::Expired),
                Poll::Declined => return Ok(Ended::Declined),
                Poll::Token(token) => {
                    *self.pending.lock().unwrap() = None;
                    let account = user(&token).await?;
                    let signed = Signed {
                        token,
                        account: account.clone(),
                    };
                    *self.signed.lock().unwrap() = Some(Some(signed.clone()));
                    let remembered = store::save(&signed).await;
                    return Ok(Ended::SignedIn {
                        account,
                        remembered,
                    });
                }
            }
        }
    }

    /// Stops the sign-in under way; its wait ends at its next poll.
    pub fn cancel(&self) {
        *self.pending.lock().unwrap() = None;
    }

    /// The account's repositories, most recently pushed first, 100 to a page.
    pub async fn repositories(&self, page: u32) -> Result<Vec<Repository>, Failure> {
        let token = self.token().await?;
        let result = async {
            let url = format!("{API}/user/repos?sort=pushed&per_page=100&page={page}");
            let response = api(&token, client()?.get(url)).await?;
            repositories_reply(&response.text().await.map_err(|_| unreadable())?)
        }
        .await;
        self.checked(result).await
    }

    /// Creates a repository under the account; returns its HTTPS address.
    pub async fn create(&self, name: &str, private: bool) -> Result<String, Failure> {
        #[derive(Deserialize)]
        struct Created {
            clone_url: String,
        }
        let token = self.token().await?;
        let result = async {
            let body = serde_json::json!({ "name": name, "private": private });
            let response = api(
                &token,
                client()?.post(format!("{API}/user/repos")).json(&body),
            )
            .await?;
            let body = response.text().await.map_err(|_| unreadable())?;
            let created: Created = serde_json::from_str(&body).map_err(|_| unreadable())?;
            Ok::<_, Failure>(created.clone_url)
        }
        .await;
        self.checked(result).await
    }
}

/// The token in Credential Manager, as a generic credential whose user name is the account's login.
#[cfg(windows)]
mod store {
    use super::Signed;
    use windows::core::{w, PCWSTR, PWSTR};
    use windows::Win32::Security::Credentials::{
        CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
        CRED_TYPE_GENERIC,
    };

    const TARGET: PCWSTR = w!("Gittin/github.com");

    pub async fn load() -> Option<Signed> {
        let mut credential: *mut CREDENTIALW = std::ptr::null_mut();
        unsafe {
            CredReadW(TARGET, CRED_TYPE_GENERIC, None, &mut credential).ok()?;
            let (data, size) = (
                (*credential).CredentialBlob,
                (*credential).CredentialBlobSize,
            );
            // A credential of that name with no blob, as another tool may write, keeps nothing.
            let blob =
                (!data.is_null()).then(|| std::slice::from_raw_parts(data, size as usize).to_vec());
            CredFree(credential as *const _);
            serde_json::from_slice(&blob?).ok()
        }
    }

    /// Keeps the sign-in, replacing any earlier one; false when Credential Manager can't.
    pub async fn save(signed: &Signed) -> bool {
        let mut user: Vec<u16> = signed.account.login.encode_utf16().chain([0]).collect();
        let mut blob = serde_json::to_vec(signed).expect("a sign-in serialises");
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            // CredWriteW doesn't write through it.
            TargetName: PWSTR(TARGET.0.cast_mut()),
            UserName: PWSTR(user.as_mut_ptr()),
            CredentialBlobSize: blob.len() as u32,
            CredentialBlob: blob.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            ..Default::default()
        };
        unsafe { CredWriteW(&credential, 0).is_ok() }
    }

    pub async fn forget() {
        let _ = unsafe { CredDeleteW(TARGET, CRED_TYPE_GENERIC, None) };
    }
}

/// The token in the app's keyring file, which oo7 encrypts with the key the Secret portal gives the Flatpak.
/// Without that key nothing is kept, and the sign-in lasts until Gittin quits.
#[cfg(target_os = "linux")]
mod store {
    use super::Signed;
    use oo7::file::UnlockedKeyring;

    const SERVICE: [(&str, &str); 1] = [("service", "github.com")];

    async fn keyring() -> Option<UnlockedKeyring> {
        let secret = oo7::ashpd::desktop::secret::retrieve().await.ok()?;
        UnlockedKeyring::open("default", oo7::Secret::from(secret))
            .await
            .ok()
    }

    pub async fn load() -> Option<Signed> {
        let items = keyring().await?.search_items(&SERVICE).await.ok()?;
        let secret = items.first()?.as_unlocked().secret();
        serde_json::from_slice(&secret).ok()
    }

    /// Keeps the sign-in, replacing any earlier one; false when the portal gives no key.
    pub async fn save(signed: &Signed) -> bool {
        let Some(keyring) = keyring().await else {
            return false;
        };
        let attributes = [
            ("service", "github.com"),
            ("account", signed.account.login.as_str()),
        ];
        let secret = serde_json::to_vec(signed).expect("a sign-in serialises");
        keyring.delete(&SERVICE).await.is_ok()
            && keyring
                .create_item("Gittin: GitHub", &attributes, secret, false)
                .await
                .is_ok()
    }

    pub async fn forget() {
        if let Some(keyring) = keyring().await {
            let _ = keyring.delete(&SERVICE).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_device_code_reply_gives_the_code_to_show() {
        let reply = r#"{"device_code":"3584d83530557fdd1f46af8289938c8ef79f9dc5","user_code":"WDJB-MJHT","verification_uri":"https://github.com/login/device","expires_in":900,"interval":5}"#;
        let shown = DeviceCode {
            user_code: "WDJB-MJHT".into(),
            verification_uri: "https://github.com/login/device".into(),
            expires_in: 900,
        };
        let pending = Pending {
            device_code: "3584d83530557fdd1f46af8289938c8ef79f9dc5".into(),
            interval: 5,
        };
        assert_eq!(code_reply(reply).unwrap(), (shown, pending));
        let disabled = r#"{"error":"device_flow_disabled","error_description":"Device flow has not been enabled for this app."}"#;
        assert_eq!(
            code_reply(disabled),
            Err(message("Device flow has not been enabled for this app."))
        );
    }

    #[test]
    fn each_poll_reply_is_read() {
        let pending = r#"{"error":"authorization_pending","error_description":"The authorization request is still pending.","error_uri":"https://docs.github.com"}"#;
        assert_eq!(poll_reply(pending).unwrap(), Poll::Waiting);
        assert_eq!(
            poll_reply(r#"{"error":"slow_down","interval":10}"#).unwrap(),
            Poll::SlowDown
        );
        assert_eq!(
            poll_reply(r#"{"error":"expired_token"}"#).unwrap(),
            Poll::Expired
        );
        assert_eq!(
            poll_reply(r#"{"error":"token_expired"}"#).unwrap(),
            Poll::Expired
        );
        assert_eq!(
            poll_reply(r#"{"error":"access_denied"}"#).unwrap(),
            Poll::Declined
        );
        let token = r#"{"access_token":"gho_16C7e42F292c6912E7710c838347Ae178B4a","token_type":"bearer","scope":"repo"}"#;
        assert_eq!(
            poll_reply(token).unwrap(),
            Poll::Token("gho_16C7e42F292c6912E7710c838347Ae178B4a".into())
        );
        let wrong = r#"{"error":"incorrect_device_code","error_description":"The device_code provided is not valid."}"#;
        assert_eq!(
            poll_reply(wrong),
            Err(message("The device_code provided is not valid."))
        );
    }

    #[test]
    fn the_token_s_scopes_come_from_github_s_header() {
        assert_eq!(scopes(Some("repo, workflow")), vec!["repo", "workflow"]);
        assert_eq!(scopes(Some("")), Vec::<String>::new());
        assert_eq!(scopes(None), Vec::<String>::new());
    }

    #[test]
    fn repositories_and_github_s_refusals_are_read() {
        let listed = r#"[{"id":1296269,"full_name":"octocat/Hello-World","private":false,"clone_url":"https://github.com/octocat/Hello-World.git","pushed_at":"2011-01-26T19:06:43Z"}]"#;
        let expected = vec![Repository {
            full_name: "octocat/Hello-World".into(),
            clone_url: "https://github.com/octocat/Hello-World.git".into(),
            private: false,
        }];
        assert_eq!(repositories_reply(listed).unwrap(), expected);
        let taken = r#"{"message":"Repository creation failed.","errors":[{"resource":"Repository","code":"custom","field":"name","message":"name already exists on this account"}],"documentation_url":"https://docs.github.com/rest/repos/repos#create-a-repository-for-the-authenticated-user","status":"422"}"#;
        assert_eq!(
            reason(422, taken),
            "Repository creation failed: name already exists on this account"
        );
        assert_eq!(reason(502, "<html></html>"), "GitHub answered 502.");
    }

    #[test]
    fn api_requests_follow_no_redirects() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let mut stream = stream.unwrap();
                let mut buffer = [0; 1024];
                let _ = stream.read(&mut buffer);
                let answer = format!("HTTP/1.1 301 Moved Permanently\r\nLocation: http://localhost:{port}/elsewhere\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                let _ = stream.write_all(answer.as_bytes());
            }
        });
        let status = tauri::async_runtime::block_on(async {
            client()
                .unwrap()
                .get(format!("http://127.0.0.1:{port}/user"))
                .send()
                .await
                .unwrap()
                .status()
        });
        assert_eq!(status, 301);
    }
}

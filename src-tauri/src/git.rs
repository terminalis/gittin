// Git for folders that are repositories: finding them, starting one, committing what Gittin saves, reading a file's
// history, and cloning, fetching, merging and pushing over HTTPS. Plain functions over paths and repositories;
// main.rs offers them to the page as commands.

use git2::build::{CheckoutBuilder, RepoBuilder};
use git2::{
    AttrCheckFlags, Commit, Config, Cred, DiffFindOptions, ErrorCode, FetchOptions, FetchPrune,
    ObjectType, Oid, PushOptions, RemoteCallbacks, RemoteRedirect, Repository,
    RepositoryInitOptions, RepositoryState, Signature, Sort, Status, Tree, TreeWalkMode,
    TreeWalkResult,
};
use serde::{Deserialize, Serialize};
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::path::Path;

/// The name and email Gittin keeps for repositories whose git settings have none.
#[derive(Deserialize)]
pub struct Author {
    pub name: String,
    pub email: String,
}

/// A path Gittin saved but left out of the commit, and why: `lfs`, `filter` or `ignored`.
#[derive(Serialize, Debug, PartialEq)]
pub struct LeftOut {
    pub path: String,
    pub reason: &'static str,
}

/// Why nothing was committed.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Reason {
    /// git is set to sign commits, which libgit2 doesn't do.
    Signs,
    /// Another tool left a merge, rebase or cherry-pick part-way.
    Busy,
    /// The repository is on a commit, not a branch, where a commit could be lost.
    Detached,
    /// git's settings name no author, and Gittin was given none.
    Identity,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Outcome {
    /// `hooks`: the repository has commit hooks, which libgit2 doesn't run.
    Committed {
        hooks: bool,
        left_out: Vec<LeftOut>,
    },
    /// The files already matched the last commit.
    Unchanged {
        left_out: Vec<LeftOut>,
    },
    Refused {
        reason: Reason,
    },
}

/// A commit in a file's history.
#[derive(Serialize, Debug, PartialEq)]
pub struct Entry {
    pub id: String,
    pub message: String,
    pub author: String,
    /// Seconds since 1970.
    pub time: i64,
}

/// The repositories at `folder` and directly inside it, as paths relative to it ("" for the folder itself).
/// Repositories outside what `allowed` reaches, or that libgit2 can't open, are left out.
pub fn repositories(
    folder: &Path,
    allowed: impl Fn(&Path) -> bool,
) -> std::io::Result<Vec<String>> {
    let mut found = Vec::new();
    if folder.join(".git").exists() {
        found.push(String::new());
    }
    for entry in std::fs::read_dir(folder)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() && entry.path().join(".git").exists() {
            found.push(entry.file_name().to_string_lossy().into_owned());
        }
    }
    found.retain(|name| open(&folder.join(name), &allowed).is_some());
    found.sort();
    Ok(found)
}

/// The repository at `root`, when it works on `root` itself (not a folder its settings point elsewhere) and
/// keeps its git data, shared data included, where `allowed` says Gittin may reach. Gittin works on the
/// repository this returns, so changing its settings afterwards can't move its working folder or git data.
pub fn open(root: &Path, allowed: impl Fn(&Path) -> bool) -> Option<Repository> {
    let real = |path: &Path| std::fs::canonicalize(path).ok();
    let repo = Repository::open(root).ok()?;
    let (workdir, root) = (repo.workdir().and_then(real)?, real(root)?);
    let reachable = [repo.path(), repo.commondir()]
        .into_iter()
        .all(|path| real(path).is_some_and(|path| allowed(&path)));
    (workdir == root && reachable).then_some(repo)
}

/// The first branch of a new repository: git's `init.defaultBranch` when set, otherwise `main`, as
/// GitHub and Git 3.0 use, rather than libgit2's own `master`.
pub fn default_branch(config: &Config) -> String {
    config
        .get_string("init.defaultBranch")
        .ok()
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "main".into())
}

/// Starts a repository in `folder`, writing its `.git`, and for `leave_out` (names directly inside the folder) lines in
/// `.gitignore` that keep them out of commits.
pub fn init(folder: &Path, leave_out: &[String]) -> Result<(), git2::Error> {
    let branch = default_branch(&Config::open_default()?);
    Repository::init_opts(folder, RepositoryInitOptions::new().initial_head(&branch))?;
    if leave_out.is_empty() {
        return Ok(());
    }
    let file = folder.join(".gitignore");
    let mut text = std::fs::read_to_string(&file).unwrap_or_default();
    if !text.is_empty() && !text.ends_with('\n') {
        text.push('\n');
    }
    for name in leave_out {
        text.push_str(&ignore_line(name));
        text.push('\n');
    }
    std::fs::write(&file, text).map_err(|error| git2::Error::from_str(&error.to_string()))
}

/// A `.gitignore` line matching only the entry `name` directly inside the repository's folder, with the characters
/// `.gitignore` reads specially escaped.
fn ignore_line(name: &str) -> String {
    let mut line = String::from("/");
    for c in name.chars() {
        if matches!(c, '\\' | '*' | '?' | '[' | ' ') {
            line.push('\\');
        }
        line.push(c);
    }
    line
}

/// The files a first commit takes: everything in the repository's folder that git doesn't ignore.
pub fn untracked(repo: &Repository) -> Result<Vec<String>, git2::Error> {
    let mut options = git2::StatusOptions::new();
    options.include_untracked(true).recurse_untracked_dirs(true);
    Ok(repo
        .statuses(Some(&mut options))?
        .iter()
        .filter(|entry| entry.status().contains(Status::WT_NEW))
        .filter_map(|entry| entry.path().ok().map(str::to_string))
        .collect())
}

/// Commits only `paths`, relative to the repository's folder, as they are on disk: a file that exists is
/// added, one that doesn't is removed (a deleted folder by its own path). Anything else already staged
/// stays staged and out of the commit. Files stored in Git LFS or under another git filter, and
/// untracked ones git ignores, are left out.
pub fn commit(
    repo: &Repository,
    paths: &[String],
    message: &str,
    author: Option<&Author>,
) -> Result<Outcome, git2::Error> {
    let root = repo
        .workdir()
        .ok_or_else(|| git2::Error::from_str("the repository has no working folder"))?;
    let config = repo.config()?;
    if config.get_bool("commit.gpgsign").unwrap_or(false) {
        return Ok(Outcome::Refused {
            reason: Reason::Signs,
        });
    }
    if repo.state() != RepositoryState::Clean {
        return Ok(Outcome::Refused {
            reason: Reason::Busy,
        });
    }
    if repo.head_detached()? {
        return Ok(Outcome::Refused {
            reason: Reason::Detached,
        });
    }
    let signature = match (repo.signature(), author) {
        (Ok(signature), _) => signature,
        (Err(_), Some(author)) => Signature::now(&author.name, &author.email)?,
        (Err(_), None) => {
            return Ok(Outcome::Refused {
                reason: Reason::Identity,
            })
        }
    };
    let parent = match repo.head() {
        Ok(head) => Some(head.peel_to_commit()?),
        Err(error) if error.code() == ErrorCode::UnbornBranch => None,
        Err(error) => return Err(error),
    };
    let mut index = repo.index()?;
    let mut only = git2::Index::new()?;
    if let Some(parent) = &parent {
        only.read_tree(&parent.tree()?)?;
    }
    let mut left_out = Vec::new();
    for path in paths {
        let relative = Path::new(path);
        let full = root.join(relative);
        if full.is_file() {
            if let Some(driver) = filter_of(repo, relative)? {
                left_out.push(LeftOut {
                    path: path.clone(),
                    reason: if driver == "lfs" { "lfs" } else { "filter" },
                });
            } else if index.get_path(relative, 0).is_none()
                && repo.status_should_ignore(relative)?
            {
                left_out.push(LeftOut {
                    path: path.clone(),
                    reason: "ignored",
                });
            } else {
                index.add_path(relative)?;
                if let Some(entry) = index.get_path(relative, 0) {
                    only.add(&entry)?;
                }
            }
        } else if !full.exists() {
            for index in [&mut index, &mut only] {
                index.remove_path(relative)?;
                index.remove_dir(relative, 0)?;
            }
        }
    }
    index.write()?;
    let tree = repo.find_tree(only.write_tree_to(repo)?)?;
    let unchanged = match &parent {
        Some(parent) => parent.tree_id() == tree.id(),
        None => tree.is_empty(),
    };
    if unchanged {
        return Ok(Outcome::Unchanged { left_out });
    }
    let parents: Vec<&Commit> = parent.iter().collect();
    repo.commit(
        Some("HEAD"),
        &signature,
        &signature,
        message,
        &tree,
        &parents,
    )?;
    Ok(Outcome::Committed {
        hooks: hooks(repo, &config, &COMMIT_HOOKS),
        left_out,
    })
}

/// Hooks git would run around a commit, and around Sync's merge commit and push. libgit2 runs none of them.
const COMMIT_HOOKS: [&str; 4] = [
    "pre-commit",
    "prepare-commit-msg",
    "commit-msg",
    "post-commit",
];
const SYNC_HOOKS: [&str; 5] = [
    "pre-merge-commit",
    "prepare-commit-msg",
    "commit-msg",
    "post-merge",
    "pre-push",
];

/// Whether the repository has any of the hooks `names`.
fn hooks(repo: &Repository, config: &Config, names: &[&str]) -> bool {
    let folder = match config.get_path("core.hooksPath") {
        Ok(path) if path.is_absolute() => path,
        Ok(path) => repo.workdir().unwrap_or(repo.path()).join(path),
        Err(_) => repo.commondir().join("hooks"),
    };
    names.iter().any(|name| folder.join(name).is_file())
}

/// The blob a commit holds at `path`, if any.
fn blob_at(commit: &Commit, path: &Path) -> Option<Oid> {
    commit
        .tree()
        .ok()?
        .get_path(path)
        .ok()
        .map(|entry| entry.id())
}

/// The commits that changed `path`, newest first, after skipping `skip` of them; at most `take`.
pub fn log(
    repo: &Repository,
    path: &str,
    skip: usize,
    take: usize,
) -> Result<Vec<Entry>, git2::Error> {
    match repo.head() {
        Err(error) if error.code() == ErrorCode::UnbornBranch => return Ok(Vec::new()),
        Err(error) => return Err(error),
        Ok(_) => {}
    }
    let mut walk = repo.revwalk()?;
    walk.push_head()?;
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;
    let path = Path::new(path);
    let (mut entries, mut matched) = (Vec::new(), 0);
    for oid in walk {
        let commit = repo.find_commit(oid?)?;
        let blob = blob_at(&commit, path);
        let unchanged = match commit.parent_count() {
            0 => blob.is_none(),
            _ => commit
                .parents()
                .any(|parent| blob_at(&parent, path) == blob),
        };
        if unchanged {
            continue;
        }
        matched += 1;
        if matched <= skip {
            continue;
        }
        entries.push(Entry {
            id: commit.id().to_string(),
            message: commit
                .summary()
                .ok()
                .flatten()
                .unwrap_or_default()
                .to_string(),
            author: commit.author().name().unwrap_or_default().to_string(),
            time: commit.time().seconds(),
        });
        if entries.len() == take {
            break;
        }
    }
    Ok(entries)
}

/// A file's contents as of a commit.
pub fn show(repo: &Repository, commit: &str, path: &str) -> Result<Vec<u8>, git2::Error> {
    let commit = repo.find_commit(Oid::from_str(commit)?)?;
    let entry = commit.tree()?.get_path(Path::new(path))?;
    let blob = repo.find_blob(entry.id())?;
    Ok(blob.content().to_vec())
}

/// The filter driver git runs on `path` as it commits and checks out, such as `lfs`.
fn filter_of(repo: &Repository, path: &Path) -> Result<Option<String>, git2::Error> {
    let value = repo.get_attr(path, "filter", AttrCheckFlags::FILE_THEN_INDEX)?;
    Ok(match git2::AttrValue::from_string(value) {
        git2::AttrValue::String(driver) => Some(driver.to_string()),
        _ => None,
    })
}

const GITHUB: &str = "https://github.com/";

/// The GitHub account's login and token, which git sends only to addresses on https://github.com.
pub struct Login {
    pub login: String,
    pub token: String,
}

/// Why a network operation ended without its result. None of them carries the token.
#[derive(Serialize, Debug, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Failure {
    /// GitHub asked for a sign-in, and there is none.
    SignIn,
    /// GitHub refused the sign-in's token.
    Refused,
    /// The remote couldn't be reached.
    Offline,
    Message {
        message: String,
    },
}

pub fn message(text: impl Into<String>) -> Failure {
    Failure::Message {
        message: text.into(),
    }
}

/// libgit2's wording when it can't reach a host: its own sockets on Linux, WinHTTP on Windows.
const UNREACHABLE: [&str; 3] = [
    "failed to resolve address",
    "failed to connect",
    "failed to send request",
];

impl From<git2::Error> for Failure {
    fn from(error: git2::Error) -> Self {
        if UNREACHABLE
            .iter()
            .any(|start| error.message().starts_with(start))
        {
            Failure::Offline
        } else {
            message(error.message())
        }
    }
}

/// The sign-in git may send to `url`: only to an address on https://github.com.
fn login_for<'a>(url: &str, login: Option<&'a Login>) -> Option<&'a Login> {
    login.filter(|_| url.starts_with(GITHUB))
}

/// Answers git's request for credentials with the sign-in, once per operation; `asked` counts the requests, so a
/// second one means GitHub refused the token.
fn callbacks<'a>(login: Option<&'a Login>, asked: &'a Cell<u32>) -> RemoteCallbacks<'a> {
    let mut callbacks = RemoteCallbacks::new();
    callbacks.credentials(move |url, _, _| {
        asked.set(asked.get() + 1);
        match login_for(url, login) {
            Some(login) if asked.get() == 1 => Cred::userpass_plaintext(&login.login, &login.token),
            _ => Err(git2::Error::from_str("no sign-in for this address")),
        }
    });
    callbacks
}

/// Fetch options that follow no redirect to another site.
fn fetch_options(callbacks: RemoteCallbacks<'_>) -> FetchOptions<'_> {
    let mut options = FetchOptions::new();
    options
        .remote_callbacks(callbacks)
        .follow_redirects(RemoteRedirect::None);
    options
}

/// Why an operation on `url` failed, given how many times git asked for a sign-in.
fn failure(error: git2::Error, url: &str, login: Option<&Login>, asked: u32) -> Failure {
    match (asked, login_for(url, login)) {
        _ if url.starts_with(GITHUB) && error.message().contains("status code: 403") => {
            message("GitHub refused this account access to this repository.")
        }
        (0, _) | (1, Some(_)) => error.into(),
        (_, Some(_)) => Failure::Refused,
        (_, None) if url.starts_with(GITHUB) => Failure::SignIn,
        (_, None) => message(format!(
            "{url} asks for a sign-in, and Gittin signs in only to GitHub."
        )),
    }
}

/// How far a clone has got: objects received, then files written.
#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(tag = "phase", rename_all = "camelCase")]
pub enum Step {
    Receiving { done: usize, total: usize },
    Writing { done: usize, total: usize },
}

/// A finished clone: its folder, and the files that arrived in their stored form because git converts them with a
/// filter libgit2 can't run, such as Git LFS.
#[derive(Serialize, Debug, PartialEq)]
pub struct Cloned {
    pub folder: String,
    pub filtered: Vec<String>,
}

/// Refuses an address Gittin doesn't clone from: anything but https://, SSH addresses included.
pub fn check_address(url: &str) -> Result<(), Failure> {
    if url.starts_with("https://") {
        Ok(())
    } else {
        Err(message("Gittin clones from https:// addresses. On GitHub, copy the HTTPS address from the Code button."))
    }
}

/// The folder `git clone` names after a repository at `url`: its last segment, without `.git`.
fn clone_name(url: &str) -> Option<&str> {
    let last = url.trim_end_matches('/').rsplit('/').next()?;
    let name = last.strip_suffix(".git").unwrap_or(last);
    (!name.is_empty()).then_some(name)
}

/// Clones the repository at `url` into a new folder inside `into`, named after it, on its default branch, as
/// `git clone` does. `progress` hears each step and returns false to cancel. A clone that fails or is cancelled
/// removes the folder it made.
pub fn clone(
    url: &str,
    into: &Path,
    login: Option<&Login>,
    progress: impl FnMut(Step) -> bool,
) -> Result<Cloned, Failure> {
    let name = clone_name(url).ok_or_else(|| message(format!("{url} names no repository.")))?;
    let folder = into.join(name);
    if folder
        .read_dir()
        .is_ok_and(|mut entries| entries.next().is_some())
    {
        return Err(message(format!(
            "{name} already exists in {} and isn't empty.",
            into.display()
        )));
    }
    let created = !folder.exists();
    let (asked, cancelled, progress) = (Cell::new(0), Cell::new(false), RefCell::new(progress));
    // libgit2 stops only while receiving; a cancel while writing files takes effect when the clone returns.
    let report = |step: Step| {
        if !cancelled.get() && !(progress.borrow_mut())(step) {
            cancelled.set(true);
        }
        !cancelled.get()
    };
    let mut remote = callbacks(login, &asked);
    remote.transfer_progress(|stats| {
        report(Step::Receiving {
            done: stats.received_objects(),
            total: stats.total_objects(),
        })
    });
    let mut checkout = CheckoutBuilder::new();
    checkout.progress(|_, done, total| {
        report(Step::Writing { done, total });
    });
    let result = match RepoBuilder::new()
        .fetch_options(fetch_options(remote))
        .with_checkout(checkout)
        .clone(url, &folder)
    {
        _ if cancelled.get() => Err(message("The clone was cancelled.")),
        Ok(repo) => filtered(&repo)
            .map(|filtered| Cloned {
                folder: folder.to_string_lossy().into_owned(),
                filtered,
            })
            .map_err(Failure::from),
        Err(error) => Err(failure(error, url, login, asked.get())),
    };
    if result.is_err() && created {
        let _ = std::fs::remove_dir_all(&folder);
    }
    result
}

/// The checked-out files git converts with a filter libgit2 can't run.
fn filtered(repo: &Repository) -> Result<Vec<String>, git2::Error> {
    let tree = match repo.head() {
        Ok(head) => head.peel_to_tree()?,
        // An empty repository has nothing checked out.
        Err(error) if error.code() == ErrorCode::UnbornBranch => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    let mut files = Vec::new();
    tree.walk(TreeWalkMode::PreOrder, |dir, entry| {
        if entry.kind() == Some(ObjectType::Blob) {
            files.push(format!("{dir}{}", entry.name().unwrap_or_default()));
        }
        TreeWalkResult::Ok
    })?;
    let mut filtered = Vec::new();
    for file in files {
        if filter_of(repo, Path::new(&file))?.is_some() {
            filtered.push(file);
        }
    }
    Ok(filtered)
}

/// What Sync needs to know about a repository, as of the last fetch.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteState {
    /// Whether the repository has any remote; without one, Sync reads Publish to GitHub.
    pub remotes: bool,
    /// The address Sync uses: the branch's upstream remote's, otherwise `origin`'s.
    pub url: Option<String>,
    /// Whether that address is on https://github.com.
    pub github: bool,
    /// The files the commits GitHub lacks change, by their paths in the repository: every committed file before the
    /// branch is on GitHub; none without a remote.
    pub unsent: Vec<String>,
}

/// Why Sync stopped, changing nothing.
#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Stop {
    /// The repository is on a commit, not a branch.
    Detached,
    /// Another tool left a merge, rebase or cherry-pick part-way.
    Busy,
    /// A merge is needed, and git is set to sign commits, which libgit2 doesn't do.
    Signs,
    /// GitHub's changes include files under a filter libgit2 can't run, such as Git LFS.
    Filter,
    /// GitHub's changes include files another tool changed and didn't commit.
    Changed,
    /// A merge commit is needed, and git has no name and email for it.
    Identity,
}

/// What a fetch found, before anything in the folder changes. `fetched` is the commit fetched, which Sync merges.
#[derive(Serialize, Debug, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Fetched {
    /// GitHub has nothing new; `ahead` commits are to push.
    UpToDate {
        fetched: String,
        ahead: usize,
    },
    /// Only GitHub moved; `incoming` are the paths its changes touch.
    FastForward {
        fetched: String,
        incoming: Vec<String>,
    },
    /// Both moved; `incoming` are the paths GitHub's changes touch, `conflicts` those both changed on the same lines.
    Merge {
        fetched: String,
        incoming: Vec<String>,
        conflicts: Vec<String>,
    },
    /// The branch has no upstream, or GitHub doesn't have it: Sync publishes it to `origin`.
    Publish,
    Stopped {
        reason: Stop,
        paths: Vec<String>,
    },
}

/// The side kept of a conflicting file.
#[derive(Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Choice {
    Mine,
    Theirs,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Synced {
    /// `pushed`: commits went to GitHub. `published`: the branch was new there and is now linked to it. `hooks`:
    /// the repository has hooks git would have run.
    Done {
        pushed: bool,
        published: bool,
        hooks: bool,
    },
    /// GitHub has commits the last fetch didn't bring; the commits stay in the repository, and the next Sync merges
    /// GitHub's.
    Moved,
    /// GitHub refused the push, with its reason; the commits stay in the repository.
    Refused {
        message: String,
    },
    Stopped {
        reason: Stop,
        paths: Vec<String>,
    },
}

/// The checked-out branch's full name, also before its first commit; none when HEAD is a commit.
fn branch(repo: &Repository) -> Option<String> {
    let head = repo.find_reference("HEAD").ok()?;
    head.symbolic_target()
        .ok()
        .flatten()
        .filter(|name| name.starts_with("refs/heads/"))
        .map(str::to_string)
}

/// A branch's upstream: its remote, the branch on that remote, and the local ref that tracks it.
struct Upstream {
    remote: String,
    merge: String,
    tracking: String,
}

fn upstream(repo: &Repository, branch: &str) -> Option<Upstream> {
    let text = |buf: git2::Buf| buf.as_str().ok().map(str::to_string);
    Some(Upstream {
        remote: text(repo.branch_upstream_remote(branch).ok()?)?,
        merge: text(repo.branch_upstream_merge(branch).ok()?)?,
        tracking: text(repo.branch_upstream_name(branch).ok()?)?,
    })
}

pub fn remote_state(repo: &Repository) -> Result<RemoteState, git2::Error> {
    let upstream = branch(repo).and_then(|branch| upstream(repo, &branch));
    let name = upstream
        .as_ref()
        .map_or("origin", |upstream| upstream.remote.as_str());
    let url = repo
        .find_remote(name)
        .ok()
        .and_then(|remote| remote.url().ok().map(str::to_string));
    let tracking = upstream.and_then(|upstream| repo.refname_to_id(&upstream.tracking).ok());
    let remotes = !repo.remotes()?.is_empty();
    Ok(RemoteState {
        remotes,
        github: url.as_deref().is_some_and(|url| url.starts_with(GITHUB)),
        url,
        unsent: if remotes {
            unsent(repo, tracking)?
        } else {
            vec![]
        },
    })
}

/// The files that differ between `tracking` (GitHub's branch as of the last fetch; none when GitHub doesn't have it)
/// and the branch's last commit. A rename counts once, under its new name.
fn unsent(repo: &Repository, tracking: Option<Oid>) -> Result<Vec<String>, git2::Error> {
    let Ok(head) = repo.head().and_then(|head| head.peel_to_tree()) else {
        return Ok(vec![]);
    };
    let base = match tracking {
        Some(id) => Some(repo.find_commit(id)?.tree()?),
        None => None,
    };
    let mut diff = repo.diff_tree_to_tree(base.as_ref(), Some(&head), None)?;
    diff.find_similar(Some(DiffFindOptions::new().renames(true)))?;
    Ok(diff
        .deltas()
        .filter_map(|delta| {
            delta
                .new_file()
                .path()
                .and_then(Path::to_str)
                .map(str::to_string)
        })
        .collect())
}

/// Whether the branch's last commit has a file at `path`.
pub fn tracked(repo: &Repository, path: &str) -> Result<bool, git2::Error> {
    let Ok(tree) = repo.head().and_then(|head| head.peel_to_tree()) else {
        return Ok(false);
    };
    Ok(tree.get_path(Path::new(path)).is_ok())
}

/// What bringing `fetched` into the checked-out branch would do, refusing what Sync can't do safely.
enum Plan<'r> {
    UpToDate(usize),
    FastForward(Commit<'r>, Vec<String>),
    Merge {
        head: Commit<'r>,
        theirs: Commit<'r>,
        index: git2::Index,
        incoming: Vec<String>,
    },
    Stopped(Stop, Vec<String>),
}

fn plan(repo: &Repository, fetched: Oid) -> Result<Plan<'_>, git2::Error> {
    if repo.state() != RepositoryState::Clean {
        return Ok(Plan::Stopped(Stop::Busy, vec![]));
    }
    let head = repo.head()?.peel_to_commit()?;
    let theirs = repo.find_commit(fetched)?;
    if head.id() == fetched || repo.graph_descendant_of(head.id(), fetched)? {
        return Ok(Plan::UpToDate(
            repo.graph_ahead_behind(head.id(), fetched)?.0,
        ));
    }
    let forward = repo.graph_descendant_of(fetched, head.id())?;
    let base = if forward {
        head.clone()
    } else {
        repo.find_commit(repo.merge_base(head.id(), fetched)?)?
    };
    // What GitHub changed is what the folder would change.
    let incoming = changed_paths(repo, &base, &theirs)?;
    let mut filtered = Vec::new();
    for path in &incoming {
        if filter_of(repo, Path::new(path))?.is_some() {
            filtered.push(path.clone());
        }
    }
    if !filtered.is_empty() {
        return Ok(Plan::Stopped(Stop::Filter, filtered));
    }
    let changed: Vec<String> = incoming
        .iter()
        .filter(|path| {
            repo.status_file(Path::new(path))
                .is_ok_and(|status| !(status - Status::IGNORED).is_empty())
        })
        .cloned()
        .collect();
    if !changed.is_empty() {
        return Ok(Plan::Stopped(Stop::Changed, changed));
    }
    if forward {
        return Ok(Plan::FastForward(theirs, incoming));
    }
    if repo.config()?.get_bool("commit.gpgsign").unwrap_or(false) {
        return Ok(Plan::Stopped(Stop::Signs, vec![]));
    }
    let index = repo.merge_commits(&head, &theirs, None)?;
    Ok(Plan::Merge {
        head,
        theirs,
        index,
        incoming,
    })
}

/// The paths that differ between two commits.
fn changed_paths(
    repo: &Repository,
    from: &Commit,
    to: &Commit,
) -> Result<Vec<String>, git2::Error> {
    let diff = repo.diff_tree_to_tree(Some(&from.tree()?), Some(&to.tree()?), None)?;
    Ok(diff
        .deltas()
        .filter_map(|delta| {
            delta
                .new_file()
                .path()
                .and_then(Path::to_str)
                .map(str::to_string)
        })
        .collect())
}

fn conflict_path(conflict: &git2::IndexConflict) -> String {
    let entry = conflict
        .our
        .as_ref()
        .or(conflict.their.as_ref())
        .or(conflict.ancestor.as_ref())
        .expect("a conflict has an entry");
    String::from_utf8_lossy(&entry.path).into_owned()
}

fn conflicts(index: &git2::Index) -> Result<Vec<String>, git2::Error> {
    let mut paths = Vec::new();
    for conflict in index.conflicts()? {
        paths.push(conflict_path(&conflict?));
    }
    Ok(paths)
}

/// Fetches the branch's upstream and works out, without changing the folder, what Sync would do.
pub fn fetch(repo: &Repository, login: Option<&Login>) -> Result<Fetched, Failure> {
    let Some(branch) = branch(repo) else {
        return Ok(Fetched::Stopped {
            reason: Stop::Detached,
            paths: vec![],
        });
    };
    let Some(upstream) = upstream(repo, &branch) else {
        return match repo.find_remote("origin") {
            Ok(_) => Ok(Fetched::Publish),
            Err(_) => Err(message(
                "This branch has no upstream, and the repository has no origin to publish it to.",
            )),
        };
    };
    let mut remote = repo.find_remote(&upstream.remote)?;
    let url = remote.url().unwrap_or_default().to_string();
    let asked = Cell::new(0);
    let refspec = format!("+{}:{}", upstream.merge, upstream.tracking);
    let mut options = fetch_options(callbacks(login, &asked));
    // A branch GitHub doesn't have leaves no tracking ref behind.
    options.prune(FetchPrune::On);
    remote
        .fetch(&[refspec], Some(&mut options), None)
        .map_err(|error| failure(error, &url, login, asked.get()))?;
    let fetched = match repo.refname_to_id(&upstream.tracking) {
        Ok(fetched) => fetched,
        // GitHub doesn't have the branch, as in an empty repository or after deleting it there: Sync publishes it.
        Err(error) if error.code() == ErrorCode::NotFound => return Ok(Fetched::Publish),
        Err(error) => return Err(error.into()),
    };
    let id = fetched.to_string();
    Ok(match plan(repo, fetched)? {
        Plan::UpToDate(ahead) => Fetched::UpToDate { fetched: id, ahead },
        Plan::FastForward(_, incoming) => Fetched::FastForward {
            fetched: id,
            incoming,
        },
        Plan::Merge {
            index, incoming, ..
        } => Fetched::Merge {
            fetched: id,
            incoming,
            conflicts: conflicts(&index)?,
        },
        Plan::Stopped(reason, paths) => Fetched::Stopped { reason, paths },
    })
}

/// git's own wording for merging a fetched branch: "Merge branch 'main' of https://github.com/owner/notes".
fn merge_message(merge: &str, url: &str) -> String {
    let url = url.trim_end_matches('/');
    let url = url.strip_suffix(".git").unwrap_or(url);
    format!(
        "Merge branch '{}' of {url}",
        merge.trim_start_matches("refs/heads/")
    )
}

/// Takes the picked side of each conflicting path, leaving a merge with no conflicts.
fn settle(index: &mut git2::Index, choices: &HashMap<String, Choice>) -> Result<(), Failure> {
    let conflicts = index.conflicts()?.collect::<Result<Vec<_>, _>>()?;
    for conflict in conflicts {
        let path = conflict_path(&conflict);
        let side = match choices.get(&path) {
            Some(Choice::Mine) => conflict.our,
            Some(Choice::Theirs) => conflict.their,
            None => return Err(message(format!("No version of {path} was picked."))),
        };
        index.conflict_remove(Path::new(&path))?;
        // A side that deleted the file leaves it deleted.
        if let Some(mut entry) = side {
            // Stage 0: no longer one side of a conflict.
            entry.flags &= !0x3000;
            index.add(&entry)?;
        }
    }
    Ok(())
}

/// Writes `tree` to the folder through a safe checkout, which refuses to overwrite files changed since the last
/// commit, then moves the branch to `commit`.
fn advance(repo: &Repository, branch: &str, tree: &Tree, commit: Oid) -> Result<(), git2::Error> {
    repo.checkout_tree(tree.as_object(), Some(CheckoutBuilder::new().safe()))?;
    repo.reference(branch, commit, true, "Sync")?;
    Ok(())
}

enum Pushed {
    Done,
    Moved,
    Refused(String),
}

/// Pushes `refspec` to `remote`, following no redirect to another site. GitHub's answer for the branch comes back
/// through libgit2's push report.
fn push(
    repo: &Repository,
    remote: &str,
    refspec: &str,
    login: Option<&Login>,
) -> Result<Pushed, Failure> {
    let mut remote = repo.find_remote(remote)?;
    let url = remote.url().unwrap_or_default().to_string();
    let (asked, refused) = (Cell::new(0), RefCell::new(None));
    let mut callbacks = callbacks(login, &asked);
    callbacks.push_update_reference(|_, status| {
        if let Some(status) = status {
            *refused.borrow_mut() = Some(status.to_string());
        }
        Ok(())
    });
    let mut options = PushOptions::new();
    options
        .remote_callbacks(callbacks)
        .follow_redirects(RemoteRedirect::None);
    match remote.push(&[refspec], Some(&mut options)) {
        // The remote has commits this repository lacks.
        Err(error) if error.code() == ErrorCode::NotFastForward => Ok(Pushed::Moved),
        Err(error) => Err(failure(error, &url, login, asked.get())),
        Ok(()) => Ok(refused.take().map_or(Pushed::Done, Pushed::Refused)),
    }
}

/// Pushes the branch to `origin` under its own name and links the two, as `git push -u origin <branch>` does.
fn publish_branch(
    repo: &Repository,
    branch: &str,
    login: Option<&Login>,
) -> Result<Synced, Failure> {
    let moved = match push(repo, "origin", &format!("{branch}:{branch}"), login)? {
        Pushed::Refused(message) => return Ok(Synced::Refused { message }),
        Pushed::Moved => true,
        Pushed::Done => false,
    };
    // Linked also when GitHub's branch of that name has commits this one lacks, so the next Sync merges them.
    let name = branch.trim_start_matches("refs/heads/");
    let mut config = repo.config()?;
    config.set_str(&format!("branch.{name}.remote"), "origin")?;
    config.set_str(&format!("branch.{name}.merge"), branch)?;
    if moved {
        return Ok(Synced::Moved);
    }
    Ok(Synced::Done {
        pushed: true,
        published: true,
        hooks: hooks(repo, &config, &SYNC_HOOKS),
    })
}

/// Brings `fetched` (the commit `fetch` returned) into the branch, with the writer's pick for each conflicting path,
/// writes the result to the folder and pushes; with no `fetched`, publishes the branch to `origin`. The folder
/// changes only once everything is settled, through a safe checkout, and no merge state is written to `.git`.
pub fn sync(
    repo: &Repository,
    fetched: Option<&str>,
    choices: &HashMap<String, Choice>,
    author: Option<&Author>,
    login: Option<&Login>,
) -> Result<Synced, Failure> {
    let Some(branch) = branch(repo) else {
        return Ok(Synced::Stopped {
            reason: Stop::Detached,
            paths: vec![],
        });
    };
    let Some(fetched) = fetched else {
        return publish_branch(repo, &publishable(repo)?, login);
    };
    let fetched = Oid::from_str(fetched)?;
    let upstream = upstream(repo, &branch)
        .ok_or_else(|| message("This branch has no upstream to sync with."))?;
    let advanced = match plan(repo, fetched)? {
        Plan::Stopped(reason, paths) => return Ok(Synced::Stopped { reason, paths }),
        Plan::UpToDate(_) => false,
        Plan::FastForward(theirs, _) => {
            advance(repo, &branch, &theirs.tree()?, fetched)?;
            true
        }
        Plan::Merge {
            head,
            theirs,
            mut index,
            ..
        } => {
            let signature = match (repo.signature(), author) {
                (Ok(signature), _) => signature,
                (Err(_), Some(author)) => Signature::now(&author.name, &author.email)?,
                (Err(_), None) => {
                    return Ok(Synced::Stopped {
                        reason: Stop::Identity,
                        paths: vec![],
                    })
                }
            };
            settle(&mut index, choices)?;
            let tree = repo.find_tree(index.write_tree_to(repo)?)?;
            let url = repo
                .find_remote(&upstream.remote)?
                .url()
                .unwrap_or_default()
                .to_string();
            let message = merge_message(&upstream.merge, &url);
            let merged = repo.commit(
                None,
                &signature,
                &signature,
                &message,
                &tree,
                &[&head, &theirs],
            )?;
            advance(repo, &branch, &tree, merged)?;
            true
        }
    };
    let head = repo.refname_to_id(&branch)?;
    let mut pushed = false;
    if repo.graph_ahead_behind(head, fetched)?.0 > 0 {
        match push(
            repo,
            &upstream.remote,
            &format!("{branch}:{}", upstream.merge),
            login,
        )? {
            Pushed::Moved => return Ok(Synced::Moved),
            Pushed::Refused(message) => return Ok(Synced::Refused { message }),
            Pushed::Done => {}
        }
        pushed = true;
    }
    Ok(Synced::Done {
        pushed,
        published: false,
        hooks: (advanced || pushed) && hooks(repo, &repo.config()?, &SYNC_HOOKS),
    })
}

/// The branch Publish to GitHub pushes: the one checked out, once it has a commit.
pub fn publishable(repo: &Repository) -> Result<String, Failure> {
    let branch = branch(repo)
        .ok_or_else(|| message("This repository isn't on a branch, so Gittin can't publish it."))?;
    repo.refname_to_id(&branch).map_err(|_| {
        message("There's nothing to publish yet: save a file in this repository first.")
    })?;
    Ok(branch)
}

/// Adds `url` as the repository's `origin` and publishes `branch` there.
pub fn publish(
    repo: &Repository,
    url: &str,
    branch: &str,
    login: Option<&Login>,
) -> Result<Synced, Failure> {
    repo.remote("origin", url)?;
    publish_branch(repo, branch, login)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::OnceLock;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// A fresh folder for one test, inside one of its own for each run. git's machine-wide and user-wide settings
    /// point at an empty folder, so this machine's own name, email and defaults don't reach the tests.
    fn folder() -> PathBuf {
        static BASE: OnceLock<PathBuf> = OnceLock::new();
        static COUNT: AtomicUsize = AtomicUsize::new(0);
        let base = BASE.get_or_init(|| {
            // Windows reuses process IDs, so the time keeps an earlier run's files apart.
            let time = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let base =
                std::env::temp_dir().join(format!("gittin-git-{}-{time}", std::process::id()));
            let empty = base.join("settings");
            fs::create_dir_all(&empty).unwrap();
            for level in [
                git2::ConfigLevel::System,
                git2::ConfigLevel::XDG,
                git2::ConfigLevel::Global,
                git2::ConfigLevel::ProgramData,
            ] {
                unsafe { git2::opts::set_search_path(level, empty.as_path()).unwrap() };
            }
            base
        });
        let path = base.join(COUNT.fetch_add(1, Ordering::SeqCst).to_string());
        fs::create_dir_all(&path).unwrap();
        path
    }

    /// A repository whose own settings name its author.
    fn repository() -> (PathBuf, Repository) {
        let root = folder();
        let repo = Repository::init(&root).unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "Writer").unwrap();
        config.set_str("user.email", "writer@example.com").unwrap();
        (root, repo)
    }

    fn write(root: &Path, path: &str, text: &str) {
        let full = root.join(path);
        fs::create_dir_all(full.parent().unwrap()).unwrap();
        fs::write(full, text).unwrap();
    }

    fn opened(root: &Path) -> Repository {
        Repository::open(root).unwrap()
    }

    /// A folder's file:// address, as a remote's address.
    fn url(path: &Path) -> String {
        let path = path.to_string_lossy().replace('\\', "/");
        format!("file:///{}", path.trim_start_matches('/'))
    }

    fn save(root: &Path, paths: &[&str], message: &str) -> Outcome {
        let paths: Vec<String> = paths.iter().map(|path| path.to_string()).collect();
        commit(&opened(root), &paths, message, None).unwrap()
    }

    fn committed(hooks: bool) -> Outcome {
        Outcome::Committed {
            hooks,
            left_out: vec![],
        }
    }

    fn head(root: &Path) -> (String, String) {
        let repo = opened(root);
        let commit = repo.head().unwrap().peel_to_commit().unwrap();
        let author = commit.author().name().unwrap().to_string();
        (commit.message().unwrap().to_string(), author)
    }

    fn tree_paths(root: &Path) -> Vec<String> {
        let repo = opened(root);
        let tree = repo.head().unwrap().peel_to_tree().unwrap();
        let mut paths = Vec::new();
        tree.walk(git2::TreeWalkMode::PreOrder, |dir, entry| {
            if entry.kind() == Some(git2::ObjectType::Blob) {
                paths.push(format!("{dir}{}", entry.name().unwrap()));
            }
            git2::TreeWalkResult::Ok
        })
        .unwrap();
        paths
    }

    #[test]
    fn repositories_are_the_folder_and_folders_directly_inside_it() {
        let root = folder();
        Repository::init(&root).unwrap();
        Repository::init(root.join("notes")).unwrap();
        Repository::init(root.join("plain/deep")).unwrap();
        assert_eq!(
            repositories(&root, inside(&root)).unwrap(),
            vec!["".to_string(), "notes".to_string()]
        );
    }

    #[test]
    fn repositories_leave_out_a_folder_whose_git_data_is_outside() {
        let base = folder();
        Repository::init(base.join("notes")).unwrap();
        let (outside, _repo) = repository();
        point_at(&base.join("linked"), &outside);
        assert_eq!(
            repositories(&base, inside(&base)).unwrap(),
            vec!["notes".to_string()]
        );
    }

    /// Makes `folder` a checkout of the repository at `target`, with a `.git` file as git does.
    fn point_at(folder: &Path, target: &Path) {
        fs::create_dir_all(folder).unwrap();
        let git_dir = target.join(".git").to_string_lossy().replace('\\', "/");
        fs::write(folder.join(".git"), format!("gitdir: {git_dir}\n")).unwrap();
    }

    /// Allows what is inside `base`.
    fn inside(base: &Path) -> impl Fn(&Path) -> bool {
        let base = fs::canonicalize(base).unwrap();
        move |path| path.starts_with(&base)
    }

    #[test]
    fn a_repository_with_its_git_data_inside_opens() {
        let base = folder();
        let root = base.join("notes");
        fs::create_dir_all(&root).unwrap();
        init(&root, &[]).unwrap();
        assert!(open(&root, inside(&base)).is_some());
        assert!(open(&root, inside(&folder())).is_none());
    }

    #[test]
    fn a_repository_set_to_work_on_another_folder_does_not_open() {
        let base = folder();
        let root = base.join("notes");
        fs::create_dir_all(&root).unwrap();
        let repo = Repository::init(&root).unwrap();
        let elsewhere = folder();
        let mut config = repo.config().unwrap();
        config
            .set_str("core.worktree", elsewhere.to_str().unwrap())
            .unwrap();
        assert!(Repository::open(&root).unwrap().workdir().is_some());
        assert!(open(&root, inside(&base)).is_none());
    }

    #[test]
    fn a_git_file_pointing_outside_does_not_open() {
        let base = folder();
        let root = base.join("notes");
        fs::create_dir_all(&root).unwrap();
        let (outside, _repo) = repository();
        let target = outside.join(".git").to_string_lossy().replace('\\', "/");
        fs::write(root.join(".git"), format!("gitdir: {target}\n")).unwrap();
        assert!(Repository::open(&root).is_ok());
        assert!(open(&root, inside(&base)).is_none());
    }

    #[test]
    fn a_linked_worktree_opens_when_its_main_repository_is_inside() {
        let base = folder();
        let main = base.join("main");
        fs::create_dir_all(&main).unwrap();
        let repo = Repository::init(&main).unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "Writer").unwrap();
        config.set_str("user.email", "writer@example.com").unwrap();
        write(&main, "a.md", "one\n");
        save(&main, &["a.md"], "Add a.md");
        let linked = base.join("linked");
        repo.worktree("linked", &linked, None).unwrap();
        assert!(open(&linked, inside(&base)).is_some());
        assert!(open(&linked, inside(&main.join(".git/worktrees"))).is_none());
    }

    #[test]
    fn the_first_branch_is_git_s_setting_or_main() {
        let file = folder().join("config");
        fs::write(&file, "[init]\n\tdefaultBranch = trunk\n").unwrap();
        assert_eq!(default_branch(&Config::open(&file).unwrap()), "trunk");
        fs::write(&file, "").unwrap();
        assert_eq!(default_branch(&Config::open(&file).unwrap()), "main");
    }

    #[test]
    fn starting_a_repository_writes_only_git_s_folder_on_main() {
        let root = folder();
        init(&root, &[]).unwrap();
        let repo = Repository::open(&root).unwrap();
        let head = repo.find_reference("HEAD").unwrap();
        assert_eq!(head.symbolic_target().unwrap(), Some("refs/heads/main"));
        let names: Vec<_> = fs::read_dir(&root)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names, vec![std::ffi::OsString::from(".git")]);
    }

    #[test]
    fn starting_a_repository_leaves_out_the_names_given_and_finds_the_rest() {
        let root = folder();
        write(&root, ".gitignore", "*.tmp");
        write(&root, "notes.md", "x");
        write(&root, "scratch.tmp", "x");
        write(&root, "Drafts [old]/a.md", "x");
        write(&root, "big file.bin", "x");
        init(
            &root,
            &["Drafts [old]".to_string(), "big file.bin".to_string()],
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(root.join(".gitignore")).unwrap(),
            "*.tmp\n/Drafts\\ \\[old]\n/big\\ file.bin\n"
        );
        assert_eq!(
            untracked(&opened(&root)).unwrap(),
            vec![".gitignore", "notes.md"]
        );
        // Linux allows the rest of .gitignore's special characters in names.
        assert_eq!(ignore_line("a*b?c\\d"), "/a\\*b\\?c\\\\d");
    }

    #[test]
    fn a_commit_adds_changes_renames_and_deletions() {
        let (root, _repo) = repository();
        write(&root, "a.md", "one\n");
        write(&root, "docs/b.md", "two\n");
        assert_eq!(
            save(&root, &["a.md", "docs/b.md"], "Add a.md; add docs/b.md"),
            committed(false)
        );
        assert_eq!(tree_paths(&root), vec!["a.md", "docs/b.md"]);
        assert_eq!(
            head(&root),
            ("Add a.md; add docs/b.md".to_string(), "Writer".to_string())
        );
        fs::rename(root.join("a.md"), root.join("c.md")).unwrap();
        assert_eq!(
            save(&root, &["a.md", "c.md"], "Rename a.md to c.md"),
            committed(false)
        );
        assert_eq!(tree_paths(&root), vec!["c.md", "docs/b.md"]);
        fs::remove_dir_all(root.join("docs")).unwrap();
        assert_eq!(save(&root, &["docs"], "Delete docs"), committed(false));
        assert_eq!(tree_paths(&root), vec!["c.md"]);
        assert_eq!(
            save(&root, &["c.md"], "Edit c.md"),
            Outcome::Unchanged { left_out: vec![] }
        );
    }

    #[test]
    fn changes_another_tool_staged_stay_out_of_the_commit() {
        let (root, _repo) = repository();
        write(&root, "a.md", "one\n");
        write(&root, "b.md", "one\n");
        save(&root, &["a.md", "b.md"], "Add files");
        write(&root, "b.md", "staged elsewhere\n");
        let other = Repository::open(&root).unwrap();
        let mut index = other.index().unwrap();
        index.add_path(Path::new("b.md")).unwrap();
        index.write().unwrap();
        assert_eq!(
            save(&root, &["a.md"], "Edit a.md"),
            Outcome::Unchanged { left_out: vec![] }
        );
        write(&root, "a.md", "two\n");
        assert_eq!(save(&root, &["a.md"], "Edit a.md"), committed(false));
        let repo = Repository::open(&root).unwrap();
        let tree = repo.head().unwrap().peel_to_tree().unwrap();
        let in_head = tree.get_path(Path::new("b.md")).unwrap().id();
        assert_eq!(repo.find_blob(in_head).unwrap().content(), b"one\n");
        let staged = repo
            .index()
            .unwrap()
            .get_path(Path::new("b.md"), 0)
            .unwrap()
            .id;
        assert_ne!(staged, in_head);
    }

    #[test]
    fn the_given_author_is_used_only_when_git_has_none() {
        let root = folder();
        Repository::init(&root).unwrap();
        write(&root, "a.md", "one\n");
        let paths = vec!["a.md".to_string()];
        assert_eq!(
            commit(&opened(&root), &paths, "Add a.md", None).unwrap(),
            Outcome::Refused {
                reason: Reason::Identity
            }
        );
        let fallback = Author {
            name: "Fallback".into(),
            email: "fallback@example.com".into(),
        };
        assert_eq!(
            commit(&opened(&root), &paths, "Add a.md", Some(&fallback)).unwrap(),
            committed(false)
        );
        assert_eq!(head(&root).1, "Fallback");
        let mut config = Repository::open(&root).unwrap().config().unwrap();
        config.set_str("user.name", "Writer").unwrap();
        config.set_str("user.email", "writer@example.com").unwrap();
        write(&root, "a.md", "two\n");
        assert_eq!(
            commit(&opened(&root), &paths, "Edit a.md", Some(&fallback)).unwrap(),
            committed(false)
        );
        assert_eq!(head(&root).1, "Writer");
    }

    #[test]
    fn signing_a_part_way_merge_and_a_detached_commit_refuse() {
        let (root, repo) = repository();
        write(&root, "a.md", "one\n");
        save(&root, &["a.md"], "Add a.md");
        write(&root, "a.md", "two\n");
        let mut config = repo.config().unwrap();
        config.set_bool("commit.gpgsign", true).unwrap();
        assert_eq!(
            save(&root, &["a.md"], "Edit a.md"),
            Outcome::Refused {
                reason: Reason::Signs
            }
        );
        config.remove("commit.gpgsign").unwrap();
        let tip = repo.head().unwrap().target().unwrap();
        fs::write(root.join(".git/MERGE_HEAD"), format!("{tip}\n")).unwrap();
        assert_eq!(
            save(&root, &["a.md"], "Edit a.md"),
            Outcome::Refused {
                reason: Reason::Busy
            }
        );
        fs::remove_file(root.join(".git/MERGE_HEAD")).unwrap();
        repo.set_head_detached(tip).unwrap();
        assert_eq!(
            save(&root, &["a.md"], "Edit a.md"),
            Outcome::Refused {
                reason: Reason::Detached
            }
        );
    }

    #[test]
    fn lfs_files_and_ignored_ones_are_left_out() {
        let (root, _repo) = repository();
        write(
            &root,
            ".gitattributes",
            "*.png filter=lfs diff=lfs merge=lfs -text\n",
        );
        write(&root, ".gitignore", "private/\n");
        write(&root, "a.png", "image");
        write(&root, "private/p.md", "secret\n");
        write(&root, "a.md", "one\n");
        let outcome = save(
            &root,
            &[
                ".gitattributes",
                ".gitignore",
                "a.png",
                "private/p.md",
                "a.md",
            ],
            "Add files",
        );
        let left_out = vec![
            LeftOut {
                path: "a.png".into(),
                reason: "lfs",
            },
            LeftOut {
                path: "private/p.md".into(),
                reason: "ignored",
            },
        ];
        assert_eq!(
            outcome,
            Outcome::Committed {
                hooks: false,
                left_out
            }
        );
        assert_eq!(
            tree_paths(&root),
            vec![".gitattributes", ".gitignore", "a.md"]
        );
    }

    #[test]
    fn files_under_another_filter_are_left_out() {
        let (root, _repo) = repository();
        write(&root, ".gitattributes", "secret.md filter=git-crypt\n");
        write(&root, "secret.md", "secret\n");
        write(&root, "a.md", "one\n");
        let outcome = save(&root, &[".gitattributes", "secret.md", "a.md"], "Add files");
        let left_out = vec![LeftOut {
            path: "secret.md".into(),
            reason: "filter",
        }];
        assert_eq!(
            outcome,
            Outcome::Committed {
                hooks: false,
                left_out
            }
        );
        assert_eq!(tree_paths(&root), vec![".gitattributes", "a.md"]);
    }

    #[test]
    fn commit_hooks_are_reported_and_samples_are_not() {
        let (root, _repo) = repository();
        fs::create_dir_all(root.join(".git/hooks")).unwrap();
        fs::write(root.join(".git/hooks/pre-commit.sample"), "").unwrap();
        write(&root, "a.md", "one\n");
        assert_eq!(save(&root, &["a.md"], "Add a.md"), committed(false));
        fs::write(root.join(".git/hooks/pre-commit"), "").unwrap();
        write(&root, "a.md", "two\n");
        assert_eq!(save(&root, &["a.md"], "Edit a.md"), committed(true));
    }

    #[test]
    fn core_hooks_path_is_followed() {
        let (root, repo) = repository();
        let mut config = repo.config().unwrap();
        config.set_str("core.hooksPath", "githooks").unwrap();
        write(&root, "githooks/pre-commit", "");
        write(&root, "a.md", "one\n");
        assert_eq!(save(&root, &["a.md"], "Add a.md"), committed(true));
    }

    #[test]
    fn hooks_in_a_worktree_are_reported() {
        let (root, repo) = repository();
        write(&root, "a.md", "one\n");
        save(&root, &["a.md"], "Add a.md");
        fs::create_dir_all(root.join(".git/hooks")).unwrap();
        fs::write(root.join(".git/hooks/pre-commit"), "").unwrap();
        let linked = folder().join("linked");
        repo.worktree("linked", &linked, None).unwrap();
        write(&linked, "a.md", "two\n");
        assert_eq!(save(&linked, &["a.md"], "Edit a.md"), committed(true));
    }

    #[test]
    fn a_file_s_log_lists_the_commits_that_changed_it_newest_first() {
        let (root, _repo) = repository();
        assert_eq!(log(&opened(&root), "a.md", 0, 10).unwrap(), vec![]);
        for (path, text, message) in [
            ("a.md", "1\n", "First"),
            ("b.md", "1\n", "Other"),
            ("a.md", "2\n", "Second"),
            ("a.md", "3\n", "Third"),
        ] {
            write(&root, path, text);
            save(&root, &[path], message);
        }
        let messages = |entries: Vec<Entry>| -> Vec<String> {
            entries.into_iter().map(|entry| entry.message).collect()
        };
        assert_eq!(
            messages(log(&opened(&root), "a.md", 0, 2).unwrap()),
            vec!["Third", "Second"]
        );
        assert_eq!(
            messages(log(&opened(&root), "a.md", 2, 2).unwrap()),
            vec!["First"]
        );
        assert_eq!(
            log(&opened(&root), "a.md", 0, 1).unwrap()[0].author,
            "Writer"
        );
        assert_eq!(log(&opened(&root), "missing.md", 0, 10).unwrap(), vec![]);
    }

    #[test]
    fn a_merge_that_only_brings_in_a_branch_s_change_is_not_listed() {
        let (root, repo) = repository();
        write(&root, "a.md", "1\n");
        write(&root, "b.md", "1\n");
        save(&root, &["a.md", "b.md"], "First");
        let first = repo.head().unwrap().peel_to_commit().unwrap();
        write(&root, "b.md", "2\n");
        save(&root, &["b.md"], "Main edits b");
        let main = repo.head().unwrap().peel_to_commit().unwrap();
        let signature = repo.signature().unwrap();
        let blob = repo.blob(b"2\n").unwrap();
        let with_new_a = |base: &Commit| {
            let mut builder = repo.treebuilder(Some(&base.tree().unwrap())).unwrap();
            builder.insert("a.md", blob, 0o100644).unwrap();
            repo.find_tree(builder.write().unwrap()).unwrap()
        };
        let feature = repo
            .commit(
                None,
                &signature,
                &signature,
                "Feature edits a",
                &with_new_a(&first),
                &[&first],
            )
            .unwrap();
        let feature = repo.find_commit(feature).unwrap();
        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            "Merge feature",
            &with_new_a(&main),
            &[&main, &feature],
        )
        .unwrap();
        let messages: Vec<String> = log(&opened(&root), "a.md", 0, 10)
            .unwrap()
            .into_iter()
            .map(|entry| entry.message)
            .collect();
        assert_eq!(messages, vec!["Feature edits a", "First"]);
    }

    #[test]
    fn show_reads_a_file_as_of_a_commit() {
        let (root, _repo) = repository();
        write(&root, "a.md", "v1\n");
        save(&root, &["a.md"], "First");
        write(&root, "a.md", "v2\n");
        save(&root, &["a.md"], "Second");
        let first = log(&opened(&root), "a.md", 1, 1).unwrap().remove(0);
        assert_eq!(show(&opened(&root), &first.id, "a.md").unwrap(), b"v1\n");
    }

    #[test]
    fn a_clone_goes_into_a_new_folder_named_after_the_repository() {
        let (origin, _repo) = repository();
        write(&origin, "a.md", "one\n");
        write(&origin, "big.bin", "pointer\n");
        save(&origin, &["a.md", "big.bin"], "Add files");
        write(
            &origin,
            ".gitattributes",
            "*.bin filter=lfs diff=lfs merge=lfs -text\n",
        );
        save(&origin, &[".gitattributes"], "Store .bin files in LFS");
        let into = folder();
        let name = origin.file_name().unwrap();
        let mut steps = Vec::new();
        let cloned = clone(&url(&origin), &into, None, |step| {
            steps.push(step);
            true
        })
        .unwrap();
        let expected = Cloned {
            folder: into.join(name).to_string_lossy().into_owned(),
            filtered: vec!["big.bin".to_string()],
        };
        assert_eq!(cloned, expected);
        assert_eq!(
            fs::read_to_string(into.join(name).join("a.md")).unwrap(),
            "one\n"
        );
        let repo = opened(&into.join(name));
        assert_eq!(repo.head().unwrap().shorthand().unwrap(), "master");
        assert!(steps
            .iter()
            .any(|step| matches!(step, Step::Writing { .. })));
    }

    #[test]
    fn a_clone_needs_an_empty_place_and_leaves_nothing_when_it_fails_or_is_cancelled() {
        let (origin, _repo) = repository();
        write(&origin, "a.md", "one\n");
        save(&origin, &["a.md"], "Add a.md");
        let name = origin.file_name().unwrap().to_string_lossy().into_owned();
        let into = folder();
        write(&into.join(&name), "kept.md", "mine\n");
        let refused = message(format!(
            "{name} already exists in {} and isn't empty.",
            into.display()
        ));
        assert_eq!(clone(&url(&origin), &into, None, |_| true), Err(refused));
        assert!(into.join(&name).join("kept.md").exists());
        let into = folder();
        let missing = folder().join("missing");
        assert!(clone(&url(&missing), &into, None, |_| true).is_err());
        assert!(!into.join("missing").exists());
        let cancelled = clone(&url(&origin), &into, None, |step| {
            matches!(step, Step::Receiving { .. })
        });
        assert_eq!(cancelled, Err(message("The clone was cancelled.")));
        assert!(!into.join(&name).exists());
    }

    #[test]
    fn only_https_addresses_clone() {
        assert_eq!(check_address("https://github.com/owner/notes.git"), Ok(()));
        for address in [
            "git@github.com:owner/notes.git",
            "ssh://git@github.com/owner/notes.git",
            "http://github.com/owner/notes.git",
        ] {
            assert_eq!(
                check_address(address),
                Err(message("Gittin clones from https:// addresses. On GitHub, copy the HTTPS address from the Code button.")),
                "{address}"
            );
        }
    }

    #[test]
    fn the_token_goes_only_to_addresses_on_https_github_com() {
        let login = Login {
            login: "writer".into(),
            token: "secret".into(),
        };
        assert!(login_for("https://github.com/owner/notes.git", Some(&login)).is_some());
        for address in [
            "http://github.com/owner/notes.git",
            "https://github.com.example.com/owner/notes.git",
            "https://gitlab.com/owner/notes.git",
            "https://example.com/https://github.com/",
            "file:///github.com/owner/notes",
        ] {
            assert!(login_for(address, Some(&login)).is_none(), "{address}");
        }
    }

    #[test]
    fn a_sign_in_github_asks_for_or_refuses_is_reported_as_such() {
        let login = Login {
            login: "writer".into(),
            token: "secret".into(),
        };
        let asked = || git2::Error::from_str("authentication required");
        let github = "https://github.com/owner/private.git";
        assert_eq!(failure(asked(), github, None, 1), Failure::SignIn);
        assert_eq!(failure(asked(), github, Some(&login), 2), Failure::Refused);
        assert_eq!(
            failure(asked(), github, Some(&login), 1),
            message("authentication required")
        );
        assert_eq!(
            failure(asked(), "https://example.com/notes.git", None, 1),
            message("https://example.com/notes.git asks for a sign-in, and Gittin signs in only to GitHub.")
        );
        let unreachable = git2::Error::from_str(
            "failed to resolve address for github.com: Name or service not known",
        );
        assert_eq!(failure(unreachable, github, None, 0), Failure::Offline);
        let forbidden = git2::Error::from_str("request failed with status code: 403");
        assert_eq!(
            failure(forbidden, github, Some(&login), 1),
            message("GitHub refused this account access to this repository.")
        );
    }

    #[test]
    fn git_follows_no_redirect_to_another_site() {
        use std::io::{Read, Write};
        use std::sync::Arc;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let requests = Arc::new(AtomicUsize::new(0));
        let counted = requests.clone();
        // A server that sends every request to another host, as a hostile redirect would.
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let mut stream = stream.unwrap();
                counted.fetch_add(1, Ordering::SeqCst);
                let (mut request, mut buffer) = (Vec::new(), [0; 1024]);
                while !request.ends_with(b"\r\n\r\n") {
                    let read = stream.read(&mut buffer).unwrap();
                    if read == 0 {
                        break;
                    }
                    request.extend_from_slice(&buffer[..read]);
                }
                let answer = format!(
                    "HTTP/1.1 302 Found\r\nLocation: https://localhost:{port}/elsewhere.git/info/refs?service=git-upload-pack\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                );
                let _ = stream.write_all(answer.as_bytes());
            }
        });
        let asked = Cell::new(0);
        let error = RepoBuilder::new()
            .fetch_options(fetch_options(callbacks(None, &asked)))
            .clone(
                &format!("http://127.0.0.1:{port}/notes.git"),
                &folder().join("notes"),
            )
            .err()
            .unwrap();
        assert!(error.message().contains("redirect"), "{}", error.message());
        assert_eq!(requests.load(Ordering::SeqCst), 1);
    }

    /// A bare repository standing in for GitHub, holding a.md and b.md on master, and the writer's clone of it.
    fn github() -> (PathBuf, PathBuf) {
        let (seed, repo) = repository();
        write(&seed, "a.md", "# A\none\n");
        write(&seed, "b.md", "# B\none\n");
        save(&seed, &["a.md", "b.md"], "First");
        let origin = folder();
        Repository::init_bare(&origin).unwrap();
        repo.remote("origin", &url(&origin))
            .unwrap()
            .push(&["refs/heads/master:refs/heads/master"], None)
            .unwrap();
        let root = writer(&origin);
        (origin, root)
    }

    /// A clone of `origin` whose settings name its author.
    fn writer(origin: &Path) -> PathBuf {
        let cloned = clone(&url(origin), &folder(), None, |_| true).unwrap();
        let root = PathBuf::from(cloned.folder);
        let mut config = opened(&root).config().unwrap();
        config.set_str("user.name", "Writer").unwrap();
        config.set_str("user.email", "writer@example.com").unwrap();
        root
    }

    /// A change made on GitHub: another clone commits `text` to `path` and pushes it.
    fn on_github(origin: &Path, path: &str, text: &str) {
        let other = writer(origin);
        write(&other, path, text);
        save(&other, &[path], "Edit on GitHub");
        opened(&other)
            .find_remote("origin")
            .unwrap()
            .push(&["refs/heads/master:refs/heads/master"], None)
            .unwrap();
    }

    fn fetched_id(fetched: &Fetched) -> String {
        match fetched {
            Fetched::UpToDate { fetched, .. }
            | Fetched::FastForward { fetched, .. }
            | Fetched::Merge { fetched, .. } => fetched.clone(),
            other => panic!("nothing fetched: {other:?}"),
        }
    }

    fn tip(root: &Path, name: &str) -> Oid {
        opened(root).refname_to_id(name).unwrap()
    }

    fn synced(pushed: bool) -> Synced {
        Synced::Done {
            pushed,
            published: false,
            hooks: false,
        }
    }

    fn stopped(reason: Stop, paths: &[&str]) -> Fetched {
        Fetched::Stopped {
            reason,
            paths: paths.iter().map(|path| path.to_string()).collect(),
        }
    }

    fn sync_now(root: &Path, fetched: &Fetched, choices: &HashMap<String, Choice>) -> Synced {
        sync(
            &opened(root),
            Some(&fetched_id(fetched)),
            choices,
            None,
            None,
        )
        .unwrap()
    }

    #[test]
    fn remote_state_tells_publish_from_sync_and_lists_files_not_on_github() {
        let (plain, _repo) = repository();
        let alone = RemoteState {
            remotes: false,
            url: None,
            github: false,
            unsent: vec![],
        };
        assert_eq!(remote_state(&opened(&plain)).unwrap(), alone);
        let (origin, root) = github();
        write(&root, "a.md", "# A\ntwo\n");
        save(&root, &["a.md"], "Edit A");
        let cloned = RemoteState {
            remotes: true,
            url: Some(url(&origin)),
            github: false,
            unsent: vec!["a.md".into()],
        };
        assert_eq!(remote_state(&opened(&root)).unwrap(), cloned);
        opened(&root)
            .remote_set_url("origin", "https://github.com/owner/notes.git")
            .unwrap();
        assert!(remote_state(&opened(&root)).unwrap().github);
    }

    #[test]
    fn a_rename_is_one_file_not_on_github_and_only_committed_files_are_tracked() {
        let (_origin, root) = github();
        assert_eq!(
            remote_state(&opened(&root)).unwrap().unsent,
            Vec::<String>::new()
        );
        fs::rename(root.join("b.md"), root.join("c.md")).unwrap();
        save(&root, &["b.md", "c.md"], "Rename B");
        assert_eq!(remote_state(&opened(&root)).unwrap().unsent, vec!["c.md"]);
        assert!(tracked(&opened(&root), "a.md").unwrap());
        assert!(tracked(&opened(&root), "c.md").unwrap());
        assert!(!tracked(&opened(&root), "b.md").unwrap());
        write(&root, "loose.md", "x");
        assert!(!tracked(&opened(&root), "loose.md").unwrap());
    }

    #[test]
    fn github_s_commits_fast_forward_into_the_folder() {
        let (origin, root) = github();
        on_github(&origin, "b.md", "# B\ntwo\n");
        let fetched = fetch(&opened(&root), None).unwrap();
        assert!(
            matches!(&fetched, Fetched::FastForward { incoming, .. } if *incoming == ["b.md"]),
            "{fetched:?}"
        );
        assert_eq!(sync_now(&root, &fetched, &HashMap::new()), synced(false));
        assert_eq!(fs::read_to_string(root.join("b.md")).unwrap(), "# B\ntwo\n");
        assert_eq!(
            tip(&root, "refs/heads/master"),
            tip(&origin, "refs/heads/master")
        );
    }

    #[test]
    fn saves_github_lacks_are_pushed_and_hooks_reported() {
        let (origin, root) = github();
        write(&root, "a.md", "# A\ntwo\n");
        save(&root, &["a.md"], "Edit A");
        fs::create_dir_all(root.join(".git/hooks")).unwrap();
        fs::write(root.join(".git/hooks/pre-push"), "").unwrap();
        let fetched = fetch(&opened(&root), None).unwrap();
        assert!(
            matches!(fetched, Fetched::UpToDate { ahead: 1, .. }),
            "{fetched:?}"
        );
        let pushed = Synced::Done {
            pushed: true,
            published: false,
            hooks: true,
        };
        assert_eq!(sync_now(&root, &fetched, &HashMap::new()), pushed);
        assert_eq!(
            tip(&origin, "refs/heads/master"),
            tip(&root, "refs/heads/master")
        );
        assert_eq!(
            remote_state(&opened(&root)).unwrap().unsent,
            Vec::<String>::new()
        );
    }

    #[test]
    fn edits_to_different_files_merge_in_one_commit_with_git_s_message() {
        let (origin, root) = github();
        on_github(&origin, "b.md", "# B\ntwo\n");
        write(&root, "a.md", "# A\ntwo\n");
        save(&root, &["a.md"], "Edit A");
        let fetched = fetch(&opened(&root), None).unwrap();
        assert!(
            matches!(&fetched, Fetched::Merge { incoming, conflicts, .. }
                if *incoming == ["b.md"] && conflicts.is_empty()),
            "{fetched:?}"
        );
        assert_eq!(sync_now(&root, &fetched, &HashMap::new()), synced(true));
        let repo = opened(&root);
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.parent_count(), 2);
        assert_eq!(
            head.message().unwrap(),
            format!("Merge branch 'master' of {}", url(&origin))
        );
        assert_eq!(head.author().name().unwrap(), "Writer");
        assert_eq!(fs::read_to_string(root.join("a.md")).unwrap(), "# A\ntwo\n");
        assert_eq!(fs::read_to_string(root.join("b.md")).unwrap(), "# B\ntwo\n");
        assert_eq!(tip(&origin, "refs/heads/master"), head.id());
        assert!(!root.join(".git/MERGE_HEAD").exists());
        assert_eq!(
            merge_message("refs/heads/main", "https://github.com/owner/notes.git/"),
            "Merge branch 'main' of https://github.com/owner/notes"
        );
    }

    #[test]
    fn each_conflicting_file_keeps_the_side_picked() {
        for (choice, kept) in [
            (Choice::Mine, "# A\nmine\n"),
            (Choice::Theirs, "# A\ngithub\n"),
        ] {
            let (origin, root) = github();
            on_github(&origin, "a.md", "# A\ngithub\n");
            write(&root, "a.md", "# A\nmine\n");
            save(&root, &["a.md"], "Edit A");
            let fetched = fetch(&opened(&root), None).unwrap();
            assert!(
                matches!(&fetched, Fetched::Merge { conflicts, .. } if *conflicts == ["a.md"]),
                "{fetched:?}"
            );
            let choices = HashMap::from([("a.md".to_string(), choice)]);
            assert_eq!(sync_now(&root, &fetched, &choices), synced(true));
            assert_eq!(fs::read_to_string(root.join("a.md")).unwrap(), kept);
            // Version history hides the merge commit: the file matches the side kept.
            let newest = log(&opened(&root), "a.md", 0, 1).unwrap().remove(0);
            assert!(
                !newest.message.starts_with("Merge branch"),
                "{}",
                newest.message
            );
        }
    }

    #[test]
    fn a_branch_github_lacks_is_published_and_linked() {
        let (origin, root) = github();
        let repo = opened(&root);
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("draft", &head, false).unwrap();
        repo.set_head("refs/heads/draft").unwrap();
        write(&root, "a.md", "# A\ndraft\n");
        save(&root, &["a.md"], "Draft A");
        assert_eq!(fetch(&opened(&root), None).unwrap(), Fetched::Publish);
        let published = Synced::Done {
            pushed: true,
            published: true,
            hooks: false,
        };
        assert_eq!(
            sync(&opened(&root), None, &HashMap::new(), None, None).unwrap(),
            published
        );
        assert_eq!(
            tip(&origin, "refs/heads/draft"),
            tip(&root, "refs/heads/draft")
        );
        let config = opened(&root).config().unwrap();
        assert_eq!(
            config.get_string("branch.draft.merge").unwrap(),
            "refs/heads/draft"
        );
        assert_eq!(
            remote_state(&opened(&root)).unwrap().unsent,
            Vec::<String>::new()
        );
    }

    #[test]
    fn a_new_repository_is_published_to_an_empty_remote() {
        let (root, _repo) = repository();
        assert_eq!(
            publishable(&opened(&root)),
            Err(message(
                "There's nothing to publish yet: save a file in this repository first."
            ))
        );
        write(&root, "a.md", "one\n");
        save(&root, &["a.md"], "Add a.md");
        let branch = publishable(&opened(&root)).unwrap();
        let origin = folder();
        Repository::init_bare(&origin).unwrap();
        let published = Synced::Done {
            pushed: true,
            published: true,
            hooks: false,
        };
        assert_eq!(
            publish(&opened(&root), &url(&origin), &branch, None).unwrap(),
            published
        );
        assert_eq!(tip(&origin, &branch), tip(&root, &branch));
        assert!(remote_state(&opened(&root)).unwrap().remotes);
    }

    #[test]
    fn a_clone_of_an_empty_repository_publishes_its_first_save() {
        let origin = folder();
        Repository::init_bare(&origin).unwrap();
        let root = writer(&origin);
        assert_eq!(fetch(&opened(&root), None).unwrap(), Fetched::Publish);
        assert_eq!(
            sync(&opened(&root), None, &HashMap::new(), None, None),
            Err(message(
                "There's nothing to publish yet: save a file in this repository first."
            ))
        );
        write(&root, "a.md", "one\n");
        save(&root, &["a.md"], "Add a.md");
        assert_eq!(fetch(&opened(&root), None).unwrap(), Fetched::Publish);
        let published = Synced::Done {
            pushed: true,
            published: true,
            hooks: false,
        };
        assert_eq!(
            sync(&opened(&root), None, &HashMap::new(), None, None).unwrap(),
            published
        );
        let branch = publishable(&opened(&root)).unwrap();
        assert_eq!(tip(&origin, &branch), tip(&root, &branch));
    }

    #[test]
    fn publishing_a_branch_github_already_has_links_it_for_the_next_sync_to_merge() {
        let (origin, root) = github();
        let other = writer(&origin);
        for (checkout, path) in [(&other, "b.md"), (&root, "a.md")] {
            let repo = opened(checkout);
            let head = repo.head().unwrap().peel_to_commit().unwrap();
            repo.branch("draft", &head, false).unwrap();
            repo.set_head("refs/heads/draft").unwrap();
            write(checkout, path, "draft\n");
            save(checkout, &[path], "Draft");
        }
        opened(&other)
            .find_remote("origin")
            .unwrap()
            .push(&["refs/heads/draft:refs/heads/draft"], None)
            .unwrap();
        assert_eq!(
            sync(&opened(&root), None, &HashMap::new(), None, None).unwrap(),
            Synced::Moved
        );
        let config = opened(&root).config().unwrap();
        assert_eq!(
            config.get_string("branch.draft.merge").unwrap(),
            "refs/heads/draft"
        );
        let fetched = fetch(&opened(&root), None).unwrap();
        assert!(matches!(fetched, Fetched::Merge { .. }), "{fetched:?}");
    }

    #[test]
    fn github_moving_between_fetch_and_push_changes_nothing() {
        let (origin, root) = github();
        write(&root, "a.md", "# A\ntwo\n");
        save(&root, &["a.md"], "Edit A");
        let fetched = fetch(&opened(&root), None).unwrap();
        on_github(&origin, "b.md", "# B\ntwo\n");
        let before = tip(&root, "refs/heads/master");
        assert_eq!(sync_now(&root, &fetched, &HashMap::new()), Synced::Moved);
        assert_eq!(tip(&root, "refs/heads/master"), before);
    }

    #[test]
    fn a_push_github_refuses_is_reported_with_its_reason() {
        let (origin, root) = github();
        write(&root, "a.md", "# A\ntwo\n");
        save(&root, &["a.md"], "Edit A");
        let fetched = fetch(&opened(&root), None).unwrap();
        // A lock on GitHub's branch makes the update fail, as a protected branch's refusal would.
        fs::write(origin.join("refs/heads/master.lock"), "").unwrap();
        let synced = sync_now(&root, &fetched, &HashMap::new());
        assert!(
            matches!(&synced, Synced::Refused { message } if message.contains("lock")),
            "{synced:?}"
        );
        assert_eq!(remote_state(&opened(&root)).unwrap().unsent, vec!["a.md"]);
    }

    #[test]
    fn sync_stops_changing_nothing_when_it_cannot_merge_safely() {
        // Not on a branch.
        let (_, root) = github();
        let repo = opened(&root);
        repo.set_head_detached(repo.head().unwrap().target().unwrap())
            .unwrap();
        assert_eq!(fetch(&repo, None).unwrap(), stopped(Stop::Detached, &[]));

        // Another tool left a merge part-way.
        let (origin, root) = github();
        on_github(&origin, "b.md", "# B\ntwo\n");
        let head = tip(&root, "refs/heads/master");
        fs::write(root.join(".git/MERGE_HEAD"), format!("{head}\n")).unwrap();
        assert_eq!(
            fetch(&opened(&root), None).unwrap(),
            stopped(Stop::Busy, &[])
        );

        // A file GitHub changed was changed here by another tool and not committed.
        let (origin, root) = github();
        on_github(&origin, "b.md", "# B\ntwo\n");
        write(&root, "b.md", "# B\nmine, uncommitted\n");
        assert_eq!(
            fetch(&opened(&root), None).unwrap(),
            stopped(Stop::Changed, &["b.md"])
        );
        assert_eq!(
            fs::read_to_string(root.join("b.md")).unwrap(),
            "# B\nmine, uncommitted\n"
        );

        // A merge in a repository that signs its commits.
        let (origin, root) = github();
        on_github(&origin, "b.md", "# B\ntwo\n");
        write(&root, "a.md", "# A\ntwo\n");
        save(&root, &["a.md"], "Edit A");
        opened(&root)
            .config()
            .unwrap()
            .set_bool("commit.gpgsign", true)
            .unwrap();
        assert_eq!(
            fetch(&opened(&root), None).unwrap(),
            stopped(Stop::Signs, &[])
        );

        // GitHub changed a file under a filter Gittin can't run.
        let (origin, root) = github();
        fs::write(root.join(".git/info/attributes"), "*.bin filter=lfs\n").unwrap();
        on_github(&origin, "x.bin", "pointer\n");
        assert_eq!(
            fetch(&opened(&root), None).unwrap(),
            stopped(Stop::Filter, &["x.bin"])
        );

        // A merge commit needs a name and email, and git has none: Gittin asks, then syncs with the answer.
        let (origin, root) = github();
        on_github(&origin, "b.md", "# B\ntwo\n");
        write(&root, "a.md", "# A\ntwo\n");
        save(&root, &["a.md"], "Edit A");
        let mut config = opened(&root).config().unwrap();
        config.remove("user.name").unwrap();
        config.remove("user.email").unwrap();
        let fetched = fetch(&opened(&root), None).unwrap();
        let identity = Synced::Stopped {
            reason: Stop::Identity,
            paths: vec![],
        };
        assert_eq!(sync_now(&root, &fetched, &HashMap::new()), identity);
        let author = Author {
            name: "Asked".into(),
            email: "asked@example.com".into(),
        };
        let answered = sync(
            &opened(&root),
            Some(&fetched_id(&fetched)),
            &HashMap::new(),
            Some(&author),
            None,
        );
        assert_eq!(answered.unwrap(), synced(true));
        assert_eq!(
            opened(&root)
                .head()
                .unwrap()
                .peel_to_commit()
                .unwrap()
                .author()
                .name()
                .unwrap(),
            "Asked"
        );
    }
}

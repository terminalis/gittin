// Git for folders that are repositories: finding them, starting one, committing what Gittin saves, reading a file's
// history, and cloning, fetching, merging and pushing over HTTPS. Plain functions over paths and repositories;
// main.rs offers them to the page as commands.

use git2::build::{CheckoutBuilder, RepoBuilder};
use git2::{
    AttrCheckFlags, Commit, Config, Cred, ErrorCode, FetchOptions, ObjectType, Oid,
    RemoteCallbacks, RemoteRedirect, Repository, RepositoryInitOptions, RepositoryState, Signature,
    Sort, TreeWalkMode, TreeWalkResult,
};
use serde::{Deserialize, Serialize};
use std::cell::{Cell, RefCell};
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

/// Starts a repository in `folder`, writing only its `.git`.
pub fn init(folder: &Path) -> Result<(), git2::Error> {
    let branch = default_branch(&Config::open_default()?);
    Repository::init_opts(folder, RepositoryInitOptions::new().initial_head(&branch))?;
    Ok(())
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
        hooks: hooks(repo, &config),
        left_out,
    })
}

/// Whether the repository has hooks git would run around a commit.
fn hooks(repo: &Repository, config: &Config) -> bool {
    let folder = match config.get_path("core.hooksPath") {
        Ok(path) if path.is_absolute() => path,
        Ok(path) => repo.workdir().unwrap_or(repo.path()).join(path),
        Err(_) => repo.commondir().join("hooks"),
    };
    [
        "pre-commit",
        "prepare-commit-msg",
        "commit-msg",
        "post-commit",
    ]
    .iter()
    .any(|name| folder.join(name).is_file())
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Once;

    /// A fresh folder for one test. git's machine-wide and user-wide settings point at an empty folder,
    /// so this machine's own name, email and defaults don't reach the tests.
    fn folder() -> PathBuf {
        static ISOLATE: Once = Once::new();
        static COUNT: AtomicUsize = AtomicUsize::new(0);
        let base = std::env::temp_dir().join(format!("gittin-git-{}", std::process::id()));
        ISOLATE.call_once(|| {
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
        init(&root).unwrap();
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
        init(&root).unwrap();
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
}

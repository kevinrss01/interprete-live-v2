use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

pub trait InputDevice {
    fn current(&self) -> Result<String, String>;
    fn select(&self, uid: &str) -> Result<(), String>;
    fn owner_alive(&self, pid: u32) -> bool;
    fn owner_start(&self, _pid: u32) -> Option<u64> {
        None
    }
    fn fallback(&self) -> Option<String> {
        None
    }
}
#[derive(Clone, Copy)]
pub struct NativeInput;
impl InputDevice for NativeInput {
    fn current(&self) -> Result<String, String> {
        #[cfg(target_os = "macos")]
        {
            unsafe extern "C" {
                fn interprete_default_input_uid(
                    buffer: *mut std::ffi::c_char,
                    capacity: usize,
                ) -> i32;
            }
            let mut bytes = vec![0_u8; 4096];
            // The bridge writes at most capacity bytes and NUL-terminates on success.
            let status =
                unsafe { interprete_default_input_uid(bytes.as_mut_ptr().cast(), bytes.len()) };
            if status != 0 {
                return Err(format!(
                    "Lecture du micro système impossible (CoreAudio {status})."
                ));
            }
            let end = bytes
                .iter()
                .position(|byte| *byte == 0)
                .ok_or("Identifiant du micro invalide.")?;
            String::from_utf8(bytes[..end].to_vec())
                .map_err(|_| "Identifiant du micro invalide.".into())
        }
        #[cfg(not(target_os = "macos"))]
        {
            Err("La bascule du micro système nécessite macOS.".into())
        }
    }
    fn select(&self, uid: &str) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            unsafe extern "C" {
                fn interprete_set_default_input_uid(uid: *const std::ffi::c_char) -> i32;
            }
            let uid = std::ffi::CString::new(uid).map_err(|_| "Identifiant du micro invalide.")?;
            // The borrowed CString remains alive for the synchronous CoreAudio call.
            let status = unsafe { interprete_set_default_input_uid(uid.as_ptr()) };
            if status == 0 {
                Ok(())
            } else {
                Err(format!(
                    "Bascule du micro système impossible (CoreAudio {status}). Vérifiez que le microphone est connecté."
                ))
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = uid;
            Err("La bascule du micro système nécessite macOS.".into())
        }
    }
    fn fallback(&self) -> Option<String> {
        #[cfg(target_os = "macos")]
        {
            unsafe extern "C" {
                fn interprete_physical_input_fallback(
                    buffer: *mut std::ffi::c_char,
                    capacity: usize,
                ) -> i32;
            }
            let mut bytes = vec![0_u8; 4096];
            // The read-only bridge selects only non-virtual/non-aggregate input identities.
            if unsafe { interprete_physical_input_fallback(bytes.as_mut_ptr().cast(), bytes.len()) }
                != 0
            {
                return None;
            }
            let end = bytes.iter().position(|byte| *byte == 0)?;
            String::from_utf8(bytes[..end].to_vec()).ok()
        }
        #[cfg(not(target_os = "macos"))]
        {
            None
        }
    }
    fn owner_start(&self, pid: u32) -> Option<u64> {
        #[cfg(target_os = "macos")]
        {
            unsafe extern "C" {
                fn interprete_process_start(pid: u32) -> u64;
            }
            // Read-only process metadata distinguishes a live owner from a recycled PID.
            let start = unsafe { interprete_process_start(pid) };
            (start != 0).then_some(start)
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = pid;
            None
        }
    }
    fn owner_alive(&self, pid: u32) -> bool {
        #[cfg(target_os = "macos")]
        {
            unsafe extern "C" {
                fn interprete_process_is_alive(pid: u32) -> i32;
            }
            // signal 0 checks liveness without sending a signal or changing the process.
            unsafe { interprete_process_is_alive(pid) != 0 }
        }
        #[cfg(not(target_os = "macos"))]
        {
            pid == std::process::id()
        }
    }
}
#[derive(Clone, Deserialize, Serialize, PartialEq)]
struct Record {
    owner: u32,
    #[serde(default)]
    owner_start: Option<u64>,
    session: String,
    previous: String,
    target: String,
}
fn read_record(path: &Path) -> Result<Option<Record>, String> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| "Le fichier de restauration du micro est invalide.".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("Impossible de lire la restauration du micro.".into()),
    }
}
fn restore_device<D: InputDevice>(device: &D, previous: &str, target: &str) -> Result<(), String> {
    if let Err(original_error) = device.select(previous) {
        let fallback = device
            .fallback()
            .filter(|uid| uid != target)
            .ok_or(original_error)?;
        device.select(&fallback)?;
    }
    Ok(())
}
pub fn recover<D: InputDevice>(device: &D, path: &Path) -> Result<(), String> {
    let Some(record) = read_record(path)? else {
        return Ok(());
    };
    // The owner may still be between claiming the journal and selecting its input.
    // A live session always keeps its record, even after a manual device override.
    if device.owner_alive(record.owner)
        && (record.owner_start.is_none()
            || device
                .owner_start(record.owner)
                .is_none_or(|start| Some(start) == record.owner_start))
    {
        return Err(
            "Une autre session contrôle déjà le micro système. Arrêtez-la avant de démarrer."
                .into(),
        );
    }
    let current = device.current()?;
    if current == record.target {
        restore_device(device, &record.previous, &record.target)?;
    }
    fs::remove_file(path)
        .map_err(|_| "Impossible de terminer la restauration du micro.".to_string())
}
pub struct InputLease<D: InputDevice = NativeInput> {
    device: D,
    path: PathBuf,
    record: Record,
    armed: bool,
}
impl<D: InputDevice> InputLease<D> {
    pub fn activate(
        device: D,
        path: PathBuf,
        session: String,
        target: String,
    ) -> Result<Option<Self>, String> {
        recover(&device, &path)?;
        let previous = device.current()?;
        // An explicitly selected virtual input was not changed by us and is not ours to restore.
        if previous == target {
            return Ok(None);
        }
        let record = Record {
            owner: std::process::id(),
            owner_start: device.owner_start(std::process::id()),
            session,
            previous,
            target,
        };
        let parent = path
            .parent()
            .ok_or("Emplacement de restauration invalide.")?;
        fs::create_dir_all(parent)
            .map_err(|_| "Impossible de préparer la restauration du micro.")?;
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        static NEXT_RECORD: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let staging = path.with_extension(format!(
            "{}.{}.tmp",
            std::process::id(),
            NEXT_RECORD.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let bytes = serde_json::to_vec(&record).map_err(|e| e.to_string())?;
        let written = (|| -> std::io::Result<()> {
            let mut file = options.open(&staging)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            // Publish a complete record atomically, without replacing a concurrent owner's file.
            fs::hard_link(&staging, &path)
        })();
        let _ = fs::remove_file(&staging);
        written.map_err(|_| "Impossible de sauvegarder le micro d’origine ; une autre session utilise peut-être la bascule automatique.".to_string())?;
        let mut lease = Self {
            device,
            path,
            record,
            armed: true,
        };
        if let Err(error) = lease.device.select(&lease.record.target) {
            let _ = lease.restore();
            return Err(error);
        }
        Ok(Some(lease))
    }
    pub fn restore(&mut self) -> Result<(), String> {
        if !self.armed {
            return Ok(());
        }
        // Another instance may have acquired a new lease after a manual device change.
        if read_record(&self.path)?.as_ref() != Some(&self.record) {
            self.armed = false;
            return Ok(());
        }
        if self.device.current()? == self.record.target {
            restore_device(&self.device, &self.record.previous, &self.record.target)?;
        }
        fs::remove_file(&self.path)
            .map_err(|_| "Impossible de terminer la restauration du micro.".to_string())?;
        self.armed = false;
        Ok(())
    }
}
impl<D: InputDevice> Drop for InputLease<D> {
    fn drop(&mut self) {
        if self.armed && self.restore().is_err() {
            eprintln!(
                "System microphone restoration pending; the saved recovery record was retained."
            );
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, rc::Rc};
    #[derive(Clone)]
    struct Fake {
        current: Rc<RefCell<String>>,
        writes: Rc<RefCell<Vec<String>>>,
        alive: bool,
        start: Rc<RefCell<u64>>,
        unavailable: Rc<RefCell<Option<String>>>,
    }
    impl Fake {
        fn new() -> Self {
            Self {
                current: Rc::new(RefCell::new("physical".into())),
                writes: Rc::new(RefCell::new(vec![])),
                alive: false,
                start: Rc::new(RefCell::new(1)),
                unavailable: Rc::new(RefCell::new(None)),
            }
        }
    }
    impl InputDevice for Fake {
        fn current(&self) -> Result<String, String> {
            Ok(self.current.borrow().clone())
        }
        fn select(&self, uid: &str) -> Result<(), String> {
            self.writes.borrow_mut().push(uid.into());
            if self.unavailable.borrow().as_deref() == Some(uid) {
                return Err("Device disconnected".into());
            }
            *self.current.borrow_mut() = uid.into();
            Ok(())
        }
        fn owner_alive(&self, _: u32) -> bool {
            self.alive
        }
        fn owner_start(&self, _: u32) -> Option<u64> {
            Some(*self.start.borrow())
        }
        fn fallback(&self) -> Option<String> {
            Some("builtin".into())
        }
    }
    fn path() -> PathBuf {
        static NEXT_PATH: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let sequence = NEXT_PATH.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        std::env::temp_dir()
            .join(format!(
                "interprete-mic-test-{}-{}-{sequence}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .expect("time")
                    .as_nanos()
            ))
            .join("restore.json")
    }
    #[test]
    fn restores_original_input_on_stop_and_drop() {
        let device = Fake::new();
        let path = path();
        let mut lease =
            InputLease::activate(device.clone(), path.clone(), "one".into(), "virtual".into())
                .expect("activate")
                .expect("lease");
        assert_eq!(&*device.current.borrow(), "virtual");
        lease.restore().expect("restore");
        drop(lease);
        assert_eq!(&*device.writes.borrow(), &["virtual", "physical"]);
        assert!(!path.exists());
    }
    #[test]
    fn respects_a_manual_device_override() {
        let device = Fake::new();
        let path = path();
        let lease = InputLease::activate(device.clone(), path, "one".into(), "virtual".into())
            .expect("activate");
        *device.current.borrow_mut() = "another-physical".into();
        drop(lease);
        assert_eq!(&*device.writes.borrow(), &["virtual"]);
        assert_eq!(&*device.current.borrow(), "another-physical");
    }
    #[test]
    fn crash_recovery_restores_only_our_unchanged_virtual_default() {
        let device = Fake::new();
        let path = path();
        let lease =
            InputLease::activate(device.clone(), path.clone(), "one".into(), "virtual".into())
                .expect("activate")
                .expect("lease");
        std::mem::forget(lease);
        recover(&device, &path).expect("recover");
        assert_eq!(&*device.current.borrow(), "physical");
        assert!(!path.exists());
    }
    #[test]
    fn a_live_owner_blocks_another_activation() {
        let mut device = Fake::new();
        device.alive = true;
        let path = path();
        let lease =
            InputLease::activate(device.clone(), path.clone(), "one".into(), "virtual".into())
                .expect("activate");
        assert!(
            InputLease::activate(device.clone(), path, "two".into(), "virtual".into()).is_err()
        );
        drop(lease);
        assert_eq!(&*device.current.borrow(), "physical");
    }
    #[test]
    fn an_old_lease_cannot_restore_over_a_new_owner() {
        let device = Fake::new();
        let path = path();
        let first =
            InputLease::activate(device.clone(), path.clone(), "one".into(), "virtual".into())
                .expect("first");
        *device.current.borrow_mut() = "new-physical".into();
        let second = InputLease::activate(device.clone(), path, "two".into(), "virtual".into())
            .expect("second");
        drop(first);
        assert_eq!(&*device.current.borrow(), "virtual");
        drop(second);
        assert_eq!(&*device.current.borrow(), "new-physical");
    }
    #[test]
    fn a_disconnected_previous_device_falls_back_to_a_physical_input() {
        let device = Fake::new();
        let path = path();
        let lease =
            InputLease::activate(device.clone(), path.clone(), "one".into(), "virtual".into())
                .expect("activate");
        *device.unavailable.borrow_mut() = Some("physical".into());
        drop(lease);
        assert_eq!(&*device.current.borrow(), "builtin");
        assert!(!path.exists());
    }
    #[test]
    fn failed_activation_removes_the_journal_without_changing_input() {
        let device = Fake::new();
        let path = path();
        *device.unavailable.borrow_mut() = Some("virtual".into());
        assert!(
            InputLease::activate(device.clone(), path.clone(), "one".into(), "virtual".into())
                .is_err()
        );
        assert_eq!(&*device.current.borrow(), "physical");
        assert!(!path.exists());
    }
    #[test]
    fn pid_reuse_does_not_block_recovery_of_a_crashed_owner() {
        let mut device = Fake::new();
        device.alive = true;
        let path = path();
        let lease =
            InputLease::activate(device.clone(), path.clone(), "one".into(), "virtual".into())
                .expect("activate")
                .expect("lease");
        std::mem::forget(lease);
        *device.start.borrow_mut() = 2;
        recover(&device, &path).expect("recover recycled owner PID");
        assert_eq!(&*device.current.borrow(), "physical");
        assert!(!path.exists());
    }
}

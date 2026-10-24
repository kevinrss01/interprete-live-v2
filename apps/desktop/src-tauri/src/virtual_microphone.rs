use serde::{Deserialize, Serialize};

pub const NAME: &str = env!("INTERPRETE_MICROPHONE_NAME");
pub const UID: &str = env!("INTERPRETE_MICROPHONE_UID");
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputDevice {
    pub name: String,
    pub uid: String,
    pub virtual_mic: bool,
    pub app_mic: bool,
}
pub fn outputs(create: bool) -> Result<Vec<OutputDevice>, String> {
    #[cfg(target_os = "macos")]
    {
        unsafe extern "C" {
            fn interprete_virtual_outputs(
                name: *const std::ffi::c_char,
                uid: *const std::ffi::c_char,
                create: bool,
            ) -> *mut std::ffi::c_char;
            fn free(ptr: *mut std::ffi::c_void);
        }
        let name = std::ffi::CString::new(NAME).map_err(|e| e.to_string())?;
        let uid = std::ffi::CString::new(UID).map_err(|e| e.to_string())?;
        // The bridge returns an owned strdup allocation; copy/parse before matching free.
        let ptr = unsafe { interprete_virtual_outputs(name.as_ptr(), uid.as_ptr(), create) };
        if ptr.is_null() {
            return Err("Impossible de préparer le micro de l’app.".into());
        }
        #[derive(Deserialize)]
        struct ResultBody {
            outputs: Vec<OutputDevice>,
            error: Option<String>,
        }
        let body: Result<ResultBody, _> =
            serde_json::from_slice(unsafe { std::ffi::CStr::from_ptr(ptr) }.to_bytes());
        unsafe {
            free(ptr.cast());
        }
        let body = body.map_err(|e| e.to_string())?;
        if let Some(error) = body.error {
            Err(error)
        } else {
            Ok(body.outputs)
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (create, NAME, UID);
        Ok(vec![])
    }
}

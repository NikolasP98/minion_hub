use reqwest::{header, Client, StatusCode};
use serde_json::Value;
use std::time::Duration;

pub const ENDPOINT: &str =
    "https://github.com/NikolasP98/minion_hub/releases/download/desktop-updates/latest.json";
const MAX_FEED_BYTES: usize = 64 * 1024;
const MAX_PACKAGE_BYTES: usize = 256 * 1024 * 1024;

pub fn client_builder() -> reqwest::ClientBuilder {
    // The updater's cached-metadata path does not initialize its TLS provider.
    // Select ring explicitly, sharing the plugin's provider instead of adding a
    // second crypto implementation (and its native compilation) to the shell.
    let _ = rustls::crypto::ring::default_provider().install_default();
    Client::builder()
}

pub async fn download_package(
    client: &Client,
    url: tauri::Url,
    mut progress: impl FnMut(usize, Option<u64>),
) -> Result<Vec<u8>, String> {
    let mut response = client
        .get(url)
        .timeout(Duration::from_secs(600))
        .send()
        .await
        .map_err(|_| "download failed")?;
    if response.status() != StatusCode::OK {
        return Err("download unavailable".into());
    }
    let total = response.content_length();
    if total.is_some_and(|n| n > MAX_PACKAGE_BYTES as u64) {
        return Err("package too large".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "download body failed")? {
        if bytes.len() + chunk.len() > MAX_PACKAGE_BYTES {
            return Err("package too large".into());
        }
        progress(chunk.len(), total);
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

#[derive(Default)]
pub struct Feed {
    cached: Option<Value>,
    etag: Option<header::HeaderValue>,
}

impl Feed {
    pub async fn fetch(&mut self, client: &Client, endpoint: &str) -> Result<Value, String> {
        let mut request = client.get(endpoint).timeout(Duration::from_secs(5));
        if let Some(etag) = &self.etag {
            request = request.header(header::IF_NONE_MATCH, etag);
        }
        let mut response = request
            .send()
            .await
            .map_err(|_| "metadata request failed")?;
        if response.status() == StatusCode::NOT_MODIFIED {
            return self
                .cached
                .clone()
                .ok_or_else(|| "304 without cached feed".into());
        }
        if response.status() != StatusCode::OK {
            return Err("metadata unavailable".into());
        }
        if response
            .content_length()
            .is_some_and(|n| n > MAX_FEED_BYTES as u64)
        {
            return Err("metadata too large".into());
        }
        let etag = response.headers().get(header::ETAG).cloned();
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| "metadata body failed")? {
            if bytes.len() + chunk.len() > MAX_FEED_BYTES {
                return Err("metadata too large".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        let value: Value = serde_json::from_slice(&bytes).map_err(|_| "invalid metadata")?;
        // Admit the full plugin schema before replacing a previously valid cache.
        serde_json::from_value::<tauri_plugin_updater::RemoteRelease>(value.clone())
            .map_err(|_| "invalid release metadata")?;
        self.cached = Some(value.clone());
        self.etag = etag;
        Ok(value)
    }
}

pub fn trusted_artifact(url: &tauri::Url, version: &str, platform: &str, extension: &str) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && url.path() == format!(
            "/NikolasP98/minion_hub/releases/download/desktop-v{version}/Minion-Hub_{version}_{platform}.{extension}"
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };

    fn server(responses: Vec<String>) -> (String, thread::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let handle = thread::spawn(move || {
            responses
                .into_iter()
                .map(|response| {
                    let (mut stream, _) = listener.accept().unwrap();
                    stream
                        .set_read_timeout(Some(Duration::from_secs(3)))
                        .unwrap();
                    let mut request = vec![0; 4096];
                    let n = stream.read(&mut request).unwrap();
                    stream.write_all(response.as_bytes()).unwrap();
                    String::from_utf8(request[..n].to_vec()).unwrap()
                })
                .collect()
        });
        (url, handle)
    }
    fn response(body: &str) -> String {
        format!("HTTP/1.1 200 OK\r\nETag: \"v1\"\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())
    }
    fn client() -> Client {
        client_builder().no_proxy().build().unwrap()
    }

    #[tokio::test]
    async fn conditional_get_reuses_valid_metadata_without_a_second_updater_request() {
        let body = r#"{"version":"1.2.3","platforms":{"linux-x86_64":{"url":"https://github.com/test","signature":"abc"}}}"#;
        let (url, server) = server(vec![
            response(body),
            "HTTP/1.1 304 Not Modified\r\nConnection: close\r\n\r\n".into(),
        ]);
        let mut feed = Feed::default();
        let first = feed.fetch(&client(), &url).await.unwrap();
        assert_eq!(feed.fetch(&client(), &url).await.unwrap(), first);
        let requests = server.join().unwrap();
        assert!(!requests[0].to_lowercase().contains("if-none-match"));
        assert!(requests[1].to_lowercase().contains("if-none-match: \"v1\""));
    }

    #[tokio::test]
    async fn rejects_invalid_oversized_unavailable_and_unbacked_304_responses() {
        for reply in [
            response("{}"),
            response("garbage"),
            "HTTP/1.1 200 OK\r\nContent-Length: 65537\r\nConnection: close\r\n\r\n".into(),
            "HTTP/1.1 503 Unavailable\r\nContent-Length: 0\r\n\r\n".into(),
            "HTTP/1.1 304 Not Modified\r\nConnection: close\r\n\r\n".into(),
        ] {
            let (url, server) = server(vec![reply]);
            assert!(Feed::default().fetch(&client(), &url).await.is_err());
            server.join().unwrap();
        }
    }

    #[test]
    fn artifact_must_match_repository_version_platform_and_format() {
        let good = "https://github.com/NikolasP98/minion_hub/releases/download/desktop-v1.2.3/Minion-Hub_1.2.3_linux-x64.AppImage";
        assert!(trusted_artifact(
            &good.parse().unwrap(),
            "1.2.3",
            "linux-x64",
            "AppImage"
        ));
        for bad in [
            good.replace("https:", "http:"),
            good.replace("github.com", "evil.test"),
            good.replace("linux-x64", "windows-x64"),
            good.replace("desktop-v1.2.3", "desktop-v1.2.2"),
            format!("{good}?token=x"),
            good.replace("github.com", "user@github.com"),
        ] {
            assert!(!trusted_artifact(
                &bad.parse().unwrap(),
                "1.2.3",
                "linux-x64",
                "AppImage"
            ));
        }
    }

    #[tokio::test]
    async fn streaming_feed_limit_and_package_limit_reject_before_installation() {
        let body = "x".repeat(MAX_FEED_BYTES + 1);
        let (url, server) = server(vec![format!(
            "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n{:x}\r\n{body}\r\n0\r\n\r\n", body.len())]);
        assert!(Feed::default().fetch(&client(), &url).await.is_err());
        server.join().unwrap();
        let (url, server) = self::server(vec![format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            MAX_PACKAGE_BYTES + 1
        )]);
        assert!(
            download_package(&client(), url.parse().unwrap(), |_, _| panic!(
                "oversized package must not start"
            ))
            .await
            .is_err()
        );
        server.join().unwrap();
    }

    #[tokio::test]
    async fn startup_metadata_request_times_out_instead_of_waiting_for_the_server() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = thread::spawn(move || {
            let (_stream, _) = listener.accept().unwrap();
            thread::sleep(Duration::from_secs(6));
        });
        assert!(Feed::default().fetch(&client(), &url).await.is_err());
        server.join().unwrap();
    }
}

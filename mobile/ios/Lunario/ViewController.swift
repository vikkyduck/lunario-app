import UIKit
import WebKit
import SafariServices
import Network

/// Контейнер приложения: WKWebView на https://lunario.online/app/ плюс нативный слой —
/// хаптика, системный шаринг, утреннее напоминание и экран «нет связи».
class ViewController: UIViewController {

    static let appURL = URL(string: "https://lunario.online/app/")!
    static let host = "lunario.online"

    private var webView: WKWebView!
    private var bridge: NativeBridge!
    private var offlineView: OfflineView!
    private let monitor = NWPathMonitor()
    private var loadedOnce = false

    private let nightColor = UIColor(red: 0x0b/255, green: 0x0a/255, blue: 0x14/255, alpha: 1)

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = nightColor

        bridge = NativeBridge()

        let config = WKWebViewConfiguration()
        // По суффиксу в User-Agent страница понимает, что открыта в iOS-оболочке,
        // и прячет то, чему не место в App Store (см. режим оболочки в site/index.html)
        config.applicationNameForUserAgent = "LunarioShell-iOS/1.0"
        if #available(iOS 14.0, *) {
            // домены из WKAppBoundDomains: включает service worker — офлайн-оболочка работает
            config.limitsNavigationsToAppBoundDomains = true
        }
        let boot = WKUserScript(source: "window.__LUN_IOS__ = true;",
                                injectionTime: .atDocumentStart, forMainFrameOnly: true)
        config.userContentController.addUserScript(boot)
        config.userContentController.add(bridge, name: "lunario")

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = nightColor
        webView.scrollView.backgroundColor = nightColor
        webView.scrollView.contentInsetAdjustmentBehavior = .never   // страница сама учитывает safe-area
        webView.allowsBackForwardNavigationGestures = false          // приложение одностраничное

        bridge.webView = webView
        bridge.presenter = self

        view.addSubview(webView)
        webView.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        offlineView = OfflineView(frame: .zero)
        offlineView.isHidden = true
        offlineView.onRetry = { [weak self] in self?.reload() }
        view.addSubview(offlineView)
        offlineView.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            offlineView.topAnchor.constraint(equalTo: view.topAnchor),
            offlineView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            offlineView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            offlineView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        // связь вернулась, а страница так и не загрузилась — пробуем сами, без кнопки
        monitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            DispatchQueue.main.async {
                guard let self = self, !self.loadedOnce, self.offlineView.isHidden == false else { return }
                self.reload()
            }
        }
        monitor.start(queue: DispatchQueue.global(qos: .utility))

        webView.load(URLRequest(url: Self.appURL))
    }

    private func reload() {
        offlineView.isHidden = true
        if webView.url != nil { webView.reload() }
        else { webView.load(URLRequest(url: Self.appURL)) }
    }

    func openExternally(_ url: URL) {
        if url.scheme == "http" || url.scheme == "https" {
            let safari = SFSafariViewController(url: url)
            safari.preferredBarTintColor = nightColor
            safari.preferredControlTintColor = UIColor(red: 0xd9/255, green: 0xb8/255, blue: 0x68/255, alpha: 1)
            present(safari, animated: true)
        } else {
            // canOpenURL здесь нельзя: без LSApplicationQueriesSchemes он всегда false,
            // а open() сам молча проигнорирует схему, которую некому открыть
            UIApplication.shared.open(url)
        }
    }
}

// MARK: - Навигация

extension ViewController: WKNavigationDelegate {

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }

        // всё, что не наш домен, открывается в Safari-контроллере поверх приложения
        if navigationAction.targetFrame?.isMainFrame != false,
           let host = url.host, !host.hasSuffix(Self.host) {
            openExternally(url)
            decisionHandler(.cancel)
            return
        }
        if url.scheme != "http" && url.scheme != "https" && url.scheme != "about" {
            openExternally(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loadedOnce = true
        offlineView.isHidden = true
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showOfflineIfNeeded(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showOfflineIfNeeded(error)
    }

    private func showOfflineIfNeeded(_ error: Error) {
        let code = (error as NSError).code
        if code == NSURLErrorCancelled { return }
        // офлайн-оболочка service worker сама покажет приложение, если уже была установлена;
        // нативный экран — только когда страница не загрузилась совсем
        if !loadedOnce { offlineView.isHidden = false }
    }
}

// MARK: - Диалоги страницы и target=_blank

extension ViewController: WKUIDelegate {

    // confirm() используется страницей для выхода и удаления аккаунта —
    // без этой реализации он молча возвращает false
    func webView(_ webView: WKWebView,
                 runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Отмена", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "Да", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Хорошо", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    // ссылки с target="_blank" (политика, согласие) — в Safari-контроллер
    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { openExternally(url) }
        return nil
    }
}

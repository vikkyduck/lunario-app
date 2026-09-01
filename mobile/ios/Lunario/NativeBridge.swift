import UIKit
import WebKit
import UserNotifications

/// Мост из страницы в систему. Страница шлёт сообщения через
/// window.webkit.messageHandlers.lunario.postMessage({type: ...}),
/// ответы уезжают обратно вызовом window.__lunReminderState(on, reason).
class NativeBridge: NSObject, WKScriptMessageHandler {

    weak var webView: WKWebView?
    weak var presenter: ViewController?

    private let reminderId = "lunario-daily"
    private let reminderKey = "reminderOn"

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let type = body["type"] as? String else { return }

        switch type {
        case "haptic":
            haptic(kind: body["kind"] as? String ?? "tap")
        case "share":
            share(text: body["text"] as? String ?? "")
        case "reminder":
            setReminder(on: body["on"] as? Bool ?? false)
        case "reminderStatus":
            reportReminderState()
        default:
            break
        }
    }

    // MARK: Хаптика

    private func haptic(kind: String) {
        switch kind {
        case "success":
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        case "medium":
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        default:
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }
    }

    // MARK: Шаринг

    private func share(text: String) {
        guard !text.isEmpty, let presenter = presenter else { return }
        let sheet = UIActivityViewController(activityItems: [text], applicationActivities: nil)
        if let pop = sheet.popoverPresentationController {
            pop.sourceView = presenter.view
            pop.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1)
            pop.permittedArrowDirections = []
        }
        presenter.present(sheet, animated: true)
    }

    // MARK: Утреннее напоминание — локальное уведомление, серверу знать о нём не нужно

    private func setReminder(on: Bool) {
        let center = UNUserNotificationCenter.current()
        if !on {
            center.removePendingNotificationRequests(withIdentifiers: [reminderId])
            UserDefaults.standard.set(false, forKey: reminderKey)
            pushState(on: false, reason: "")
            return
        }
        center.requestAuthorization(options: [.alert, .sound, .badge]) { [weak self] granted, _ in
            guard let self = self else { return }
            if !granted {
                UserDefaults.standard.set(false, forKey: self.reminderKey)
                self.pushState(on: false, reason: "denied")
                return
            }
            let content = UNMutableNotificationContent()
            content.title = "Лунарио"
            content.body = "Ваша карта дня готова ✦"
            content.sound = .default
            var at = DateComponents()
            at.hour = 9
            at.minute = 0
            let trigger = UNCalendarNotificationTrigger(dateMatching: at, repeats: true)
            let request = UNNotificationRequest(identifier: self.reminderId, content: content, trigger: trigger)
            center.removePendingNotificationRequests(withIdentifiers: [self.reminderId])
            center.add(request) { error in
                let ok = (error == nil)
                UserDefaults.standard.set(ok, forKey: self.reminderKey)
                self.pushState(on: ok, reason: ok ? "" : "failed")
            }
        }
    }

    private func reportReminderState() {
        let saved = UserDefaults.standard.bool(forKey: reminderKey)
        guard saved else { pushState(on: false, reason: ""); return }
        // включали раньше — проверяем, что разрешение не отозвано в Настройках и уведомление ещё стоит
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { [weak self] settings in
            guard let self = self else { return }
            guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else {
                self.pushState(on: false, reason: "denied")
                return
            }
            center.getPendingNotificationRequests { requests in
                let alive = requests.contains { $0.identifier == self.reminderId }
                self.pushState(on: alive, reason: "")
            }
        }
    }

    private func pushState(on: Bool, reason: String) {
        let js = "window.__lunReminderState && window.__lunReminderState(\(on ? "true" : "false"), '\(reason)');"
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(js, completionHandler: nil)
        }
    }
}

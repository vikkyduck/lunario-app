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
        case "shareImage":
            shareImage(base64: body["png"] as? String ?? "")
        case "reminder":
            setReminder(on: body["on"] as? Bool ?? false)
        case "reminderStatus":
            reportReminderState()
        case "schedule":
            schedule(body)
        case "scheduleStatus":
            reportSchedules(reason: "")
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

    /// Открытка (карта дня, руна, ответ) — PNG в base64 из canvas страницы.
    /// В системном меню появляются «Сохранить изображение», мессенджеры и AirDrop.
    private func shareImage(base64: String) {
        guard let presenter = presenter,
              let data = Data(base64Encoded: base64),
              let image = UIImage(data: data) else { return }
        let sheet = UIActivityViewController(activityItems: [image], applicationActivities: nil)
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

    // MARK: Напоминания по функциям — карта дня, настроение, привычки, аскеза, лунный день, небо.
    // Страница присылает время и регулярность; телефон ставит локальные уведомления сам.
    // freq: daily — каждый день; weekdays — по будням; weekly — в выбранный день (weekday 1 = понедельник … 7 = воскресенье);
    // dates — список дат «YYYY-MM-DD» для одноразовых напоминаний (события на небе), тогда регулярность не нужна.

    private let schedulesKey = "schedules"

    private func schedule(_ b: [String: Any]) {
        guard let id = b["id"] as? String, !id.isEmpty else { return }
        let on = b["on"] as? Bool ?? false
        let center = UNUserNotificationCenter.current()
        let prefix = "lunario-\(id)-"
        center.getPendingNotificationRequests { [weak self] requests in
            guard let self = self else { return }
            var stale = requests.map { $0.identifier }.filter { $0.hasPrefix(prefix) }
            if id == "card" { stale.append(self.reminderId) }   // прежнее единственное напоминание в 9:00
            center.removePendingNotificationRequests(withIdentifiers: stale)
            var saved = UserDefaults.standard.dictionary(forKey: self.schedulesKey) as? [String: Bool] ?? [:]
            if !on {
                saved[id] = false
                UserDefaults.standard.set(saved, forKey: self.schedulesKey)
                self.reportSchedules(reason: "")
                return
            }
            center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
                guard granted else {
                    saved[id] = false
                    UserDefaults.standard.set(saved, forKey: self.schedulesKey)
                    self.reportSchedules(reason: "denied")
                    return
                }
                let content = UNMutableNotificationContent()
                content.title = b["title"] as? String ?? "Лунарио"
                content.body = b["body"] as? String ?? ""
                content.sound = .default
                let hour = b["hour"] as? Int ?? 9, minute = b["minute"] as? Int ?? 0
                var requests: [UNNotificationRequest] = []
                if let messages = b["messages"] as? [[String: Any]] {
                    for (i, message) in messages.prefix(14).enumerated() {
                        guard let date = message["date"] as? String else { continue }
                        let parts = date.split(separator: "-").compactMap { Int($0) }
                        guard parts.count == 3 else { continue }
                        var c = DateComponents()
                        c.year = parts[0]; c.month = parts[1]; c.day = parts[2]; c.hour = hour; c.minute = minute
                        if let tz = b["tz"] as? String { c.timeZone = TimeZone(identifier: tz) }
                        let datedContent = UNMutableNotificationContent()
                        datedContent.title = message["title"] as? String ?? content.title
                        datedContent.body = message["body"] as? String ?? content.body
                        datedContent.sound = .default
                        requests.append(UNNotificationRequest(identifier: prefix + String(i), content: datedContent,
                                                              trigger: UNCalendarNotificationTrigger(dateMatching: c, repeats: false)))
                    }
                } else if let dates = b["dates"] as? [String], !dates.isEmpty {
                    for (i, d) in dates.prefix(20).enumerated() {
                        let parts = d.split(separator: "-").compactMap { Int($0) }
                        guard parts.count == 3 else { continue }
                        var c = DateComponents()
                        c.year = parts[0]; c.month = parts[1]; c.day = parts[2]; c.hour = hour; c.minute = minute
                        requests.append(UNNotificationRequest(identifier: prefix + String(i), content: content,
                                                              trigger: UNCalendarNotificationTrigger(dateMatching: c, repeats: false)))
                    }
                } else {
                    var days: [Int] = []   // Apple: 1 — воскресенье … 7 — суббота
                    switch b["freq"] as? String ?? "daily" {
                    case "weekdays": days = [2, 3, 4, 5, 6]
                    case "weekly": let wd = b["weekday"] as? Int ?? 7; days = [wd % 7 + 1]
                    default: days = []
                    }
                    if days.isEmpty {
                        var c = DateComponents(); c.hour = hour; c.minute = minute
                        requests.append(UNNotificationRequest(identifier: prefix + "d", content: content,
                                                              trigger: UNCalendarNotificationTrigger(dateMatching: c, repeats: true)))
                    } else {
                        for d in days {
                            var c = DateComponents(); c.weekday = d; c.hour = hour; c.minute = minute
                            requests.append(UNNotificationRequest(identifier: prefix + String(d), content: content,
                                                                  trigger: UNCalendarNotificationTrigger(dateMatching: c, repeats: true)))
                        }
                    }
                }
                for r in requests { center.add(r, withCompletionHandler: nil) }
                saved[id] = true
                UserDefaults.standard.set(saved, forKey: self.schedulesKey)
                self.reportSchedules(reason: "")
            }
        }
    }

    private func reportSchedules(reason: String) {
        let saved = UserDefaults.standard.dictionary(forKey: schedulesKey) as? [String: Bool] ?? [:]
        guard let data = try? JSONSerialization.data(withJSONObject: saved),
              let json = String(data: data, encoding: .utf8) else { return }
        let js = "window.__lunScheduleState && window.__lunScheduleState(\(json), '\(reason)');"
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(js, completionHandler: nil)
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

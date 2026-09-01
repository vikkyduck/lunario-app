import UIKit

/// Экран «нет связи»: показывается, только если приложение не смогло загрузиться совсем
/// (при установленном service worker офлайн-оболочка страницы берёт это на себя).
class OfflineView: UIView {

    var onRetry: (() -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = UIColor(red: 0x0b/255, green: 0x0a/255, blue: 0x14/255, alpha: 1)

        let logo = UIImageView(image: UIImage(named: "LaunchLogo"))
        logo.contentMode = .scaleAspectFit

        let title = UILabel()
        title.text = "Нет связи"
        title.textColor = UIColor(red: 0xf5/255, green: 0xf2/255, blue: 0xea/255, alpha: 1)
        title.font = .systemFont(ofSize: 22, weight: .semibold)
        title.textAlignment = .center

        let text = UILabel()
        text.text = "Проверьте интернет — и Лунарио откроется.\nВаши записи никуда не денутся."
        text.textColor = UIColor(red: 0xb9/255, green: 0xb2/255, blue: 0xcf/255, alpha: 1)
        text.font = .systemFont(ofSize: 15)
        text.numberOfLines = 0
        text.textAlignment = .center

        let button = UIButton(type: .system)
        button.setTitle("Попробовать ещё раз", for: .normal)
        button.setTitleColor(UIColor(red: 0x1c/255, green: 0x14/255, blue: 0x30/255, alpha: 1), for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 16, weight: .bold)
        button.backgroundColor = UIColor(red: 0xd9/255, green: 0xb8/255, blue: 0x68/255, alpha: 1)
        button.layer.cornerRadius = 27
        button.contentEdgeInsets = UIEdgeInsets(top: 16, left: 28, bottom: 16, right: 28)
        button.addTarget(self, action: #selector(retryTapped), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [logo, title, text, button])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 14
        stack.setCustomSpacing(22, after: text)

        addSubview(stack)
        stack.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor, constant: -20),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -32),
            logo.widthAnchor.constraint(equalToConstant: 96),
            logo.heightAnchor.constraint(equalToConstant: 96),
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    @objc private func retryTapped() { onRetry?() }
}

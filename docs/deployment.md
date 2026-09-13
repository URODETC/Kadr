# CI/CD: dev → pull request → main → SSH

Конфигурация рассчитана на GitHub Actions и Linux-сервер с Bash, Docker, современным Docker Compose (`up --wait`), `flock`, `tar` и `sha256sum`. Сборки выполняются на GitHub-hosted runner (`ubuntu-24.04`, Linux amd64); сервер ничего не компилирует. Runner должен иметь доступ к SSH сервера, а сервер — к GHCR для скачивания образов. Сервер должен быть x86_64/amd64; для ARM64 нужно сначала изменить архитектуру CI-сборки, иначе образы не запустятся.

## Что запускается

- Push в `dev`: сборка Next, проверка типов, тесты приложения и скрипта деплоя, Docker-сборки, тесты экстрактора и проверка связи контейнеров.
- PR в `main`: те же проверки. SSH-секреты в PR job не используются.
- Push в `main` после merge: те же проверки, затем деплой проверенного SHA. Прямой push в `main` тоже запускает деплой, поэтому запретите его правилом ветки.
- Ручной Run workflow: проверки; деплой только при выборе `main` и только если SHA ещё соответствует последнему коммиту `main`.

Actions забирает приватный репозиторий встроенным `GITHUB_TOKEN`, собирает оба образа, прогоняет тесты и только на `main` публикует их в GHCR:

- `ghcr.io/OWNER/REPOSITORY/app:COMMIT_SHA`
- `ghcr.io/OWNER/REPOSITORY/extractor:COMMIT_SHA`

Имена OWNER/REPOSITORY приводятся к нижнему регистру. Workflow получает `packages: write` для публикации; отдельный PAT в Actions не нужен. Новые пакеты GHCR создаются приватными: не меняйте их visibility на public. Для уже существующих пакетов проверьте приватность и доступ репозитория в package settings. Ограничения организации на GitHub Packages могут потребовать разрешения администратора.

По SSH передаются только `compose.production.yaml` и `images.env` с **digest** опубликованных образов. Исходники и Dockerfile на сервере не нужны. `.env` хранится только на сервере. Скрипт выполняет `docker compose pull` до замены сервисов, затем `up --no-build --pull never --wait`. При ошибке скачивания текущие контейнеры остаются работать. После успешного запуска переключается `current`; при неудаче скрипт пробует поднять предыдущие локальные образы и оставляет job красным. Старые релизы/образы автоматически не удаляются. Для прежних релизов со сборкой на сервере поддержан автоматический откат через их старый Compose.

Это обновление одной реплики с небольшим перерывом, без гарантии zero downtime. Откат возвращает контейнеры, но не откатывает SQLite. Для несовместимых миграций нужна отдельная резервная копия и план восстановления. Обрыв питания или SIGKILL может потребовать ручного восстановления.

## 1. Подготовка сервера

Установите Docker и Compose, настройте HTTPS reverse proxy как в README. Создайте отдельного пользователя `deploy`. Добавление в группу `docker` даёт ему фактически административный доступ к серверу: используйте отдельный SSH-ключ для этого репозитория.

```sh
sudo adduser --disabled-password --gecos '' deploy
sudo usermod -aG docker deploy
sudo install -d -o deploy -g deploy -m 700 /opt/kadr
sudo -u deploy mkdir -p /opt/kadr/shared /opt/kadr/incoming /opt/kadr/releases
```

На своём компьютере создайте отдельный ключ (оставьте passphrase пустой для автоматического входа):

```sh
ssh-keygen -t ed25519 -f ./kadr-ci -C github-actions-kadr
```

Не кладите `kadr-ci` в репозиторий: это будущий Secret `DEPLOY_SSH_KEY`. `kadr-ci.pub` — публичная часть.

Добавьте публичную часть CI-ключа в `/home/deploy/.ssh/authorized_keys`, права каталога 700, файла 600, владелец `deploy`. Перед ключом можно указать `restrict`, чтобы запретить port forwarding, PTY и agent forwarding; выполнение SSH-команд должно остаться разрешено. Приватный ключ передайте только в GitHub Secret. Проверьте SSH и `docker info` после нового входа пользователя, чтобы применилось членство в группе.

Для нового сайта создайте постоянный volume:

```sh
docker volume create kadr_anime-data
sudo -u deploy nano /opt/kadr/shared/.env
sudo chmod 600 /opt/kadr/shared/.env
```

Содержимое `/opt/kadr/shared/.env`:

```dotenv
APP_ORIGIN=https://anime.example.org
COOKIE_SECURE=true
ANIME_DATA_VOLUME=kadr_anime-data
```

`DATABASE_PATH` и внутренний адрес экстрактора задаёт Compose. Перед первым деплоем войдите в GHCR **от пользователя deploy**, не от root:

```sh
sudo -iu deploy
read -r -s -p 'GHCR read:packages token: ' ghcr_token; printf '\n'
printf '%s' "$ghcr_token" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
unset ghcr_token
```

Используйте Personal access token **classic** с `read:packages` от аккаунта, имеющего доступ к обоим приватным пакетам. При SSO авторизуйте токен для организации. Без credential helper Docker хранит credentials в `~/.docker/config.json`; оставьте файл доступным только deploy. Не добавляйте токен в `.env`, git или аргументы команд. При истечении токена повторите login. Документация: [аутентификация GHCR](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

Суперадмин и пароли автоматически не создаются. После первого успешного деплоя:

```sh
cd /opt/kadr/current
export DEPLOY_PROJECT=kadr
docker compose --project-name "$DEPLOY_PROJECT" --env-file /opt/kadr/shared/.env --env-file images.env \
  -f compose.production.yaml exec app node scripts/admin.mjs create your_username
```

### Если сайт уже работает через Compose

Сначала определите **существующие** project name и volume; не создавайте новый пустой volume вместо пользовательской базы:

```sh
docker compose ls
docker volume ls
docker inspect YOUR_APP_CONTAINER --format '{{ index .Config.Labels "com.docker.compose.project" }}'
docker inspect YOUR_APP_CONTAINER --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Name}}{{end}}{{end}}'
```

Укажите найденное имя volume в `ANIME_DATA_VOLUME`, имя проекта — в GitHub variable `DEPLOY_PROJECT`. Перед переходом сделайте резервную копию SQLite/volume. Сохранение имени проекта позволяет Compose обновить существующие сервисы, не конфликтуя за порт 3000. До первого успешного CI-деплоя ссылка `current` отсутствует: старый ручной запуск ещё не является автоматически доступной точкой отката. Сохраните его конфигурацию и образы для ручного возврата.

## 2. Настройки GitHub

Repository → Settings → Secrets and variables → Actions → Repository secrets:

| Secret | Значение |
|---|---|
| `DEPLOY_HOST` | IPv4 или DNS-имя сервера, без `https://` |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_SSH_KEY` | Приватный SSH-ключ целиком, без passphrase, отдельный для CI |
| `DEPLOY_KNOWN_HOSTS` | Проверенная запись SSH host key сервера |

Repository variables (необязательные):

| Variable | По умолчанию |
|---|---|
| `DEPLOY_PORT` | `22` |
| `DEPLOY_ROOT` | `/opt/kadr` |
| `DEPLOY_PROJECT` | `kadr` |

Путь должен быть абсолютным, без пробелов/точек и завершающего `/`. Для нестандартного порта запись known_hosts должна иметь вид `[host]:port ...`. Получить кандидат можно командой `ssh-keyscan -p 22 your-server`, но **сверьте fingerprint через доверенную консоль сервера**, прежде чем сохранять его в Secret. Fingerprint публичного ключа сервера можно вывести через доверенную консоль:

```sh
sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

Workflow не принимает host key автоматически и не отключает `StrictHostKeyChecking`.

Workflow использует repository secrets, не требует environment `production`: доступность environment/branch protection для приватных репозиториев зависит от тарифа GitHub. Если environments доступны, можно добавить `environment: production` в job `deploy` и разрешить там только `main`.

### Правило для main

Создайте ruleset/branch protection для `main`:

1. Require a pull request before merging.
2. Require status check **Checks** из workflow **CI / CD**; сначала выполните один запуск, чтобы check появился в списке.
3. Require branches to be up to date before merging.
4. Запретите force push и удаление ветки; примените ограничения к администраторам, если тариф позволяет.

Не добавляйте `Deploy main` в required checks: он не запускается в PR. Если тариф не позволяет защищать приватную ветку, workflow сам не запрещает прямые push; соблюдайте процесс вручную либо используйте тариф с защитой.

## 3. Обычная работа

```sh
git switch dev
# Изменения, commit
git push origin dev
# На GitHub: PR dev → main; дождаться Checks; Merge
```

После merge откройте Actions → CI / CD → Deploy main. Деплои сериализованы и не прерывают друг друга; дополнительно сервер использует файловую блокировку. Запуск устаревшего SHA пропускается, если main уже продвинулся. GitHub может объединять ожидающие запуски; каждый промежуточный коммит не обязан быть развёрнут отдельно.

## Ручной откат

Для релизов GHCR выберите SHA предыдущего **успешного** релиза из `/opt/kadr/releases`, для которого остались образы:

```sh
cd /opt/kadr
# Подставьте нужный SHA и имя проекта.
export DEPLOY_SHA=PUT_PREVIOUS_40_CHARACTER_SHA_HERE
export DEPLOY_PROJECT=kadr
flock deploy.lock bash -c '
  set -e
  docker compose --project-name "$DEPLOY_PROJECT" --env-file /opt/kadr/shared/.env \
    --env-file "releases/$DEPLOY_SHA/images.env" -f "releases/$DEPLOY_SHA/compose.production.yaml" \
    up -d --no-build --pull never --wait --wait-timeout 180
  ln -sfn "/opt/kadr/releases/$DEPLOY_SHA" current.next
  mv -Tf current.next current
'
```

После аварийного отката также сделайте revert ошибочного изменения в `main`, иначе следующий деплой вернёт его. Не используйте `docker compose down -v` или `docker system prune -a --volumes`: база и образы отката должны сохраниться.

## Проверка локально

```sh
bash -n scripts/deploy.sh
python3 -m unittest discover -s tests -p 'test_deploy.py'
```

Тесты скрипта рассчитаны на Linux/GNU coreutils, подменяют только Docker и flock и проверяют успех, ошибку скачивания, отсутствие сборки на сервере, неудачную проверку здоровья, откат и checksum. Они не подтверждают реальный SSH-доступ или настройки конкретного VPS.

Документация: [GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax), [Docker Compose up](https://docs.docker.com/reference/cli/docker/compose/up/).

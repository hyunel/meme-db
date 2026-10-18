#!/bin/sh
set -eu

CDPATH= cd -- "$(dirname -- "$0")"
: "${TORCH:=cuda}"
case "$TORCH" in
    cpu|cuda|xpu) ;;
    *) echo 'TORCH must be cpu, cuda, or xpu.' >&2; exit 1 ;;
esac

: "${INFERENCE_CACHE_DIR:=$PWD/cache}"
mkdir -p "$INFERENCE_CACHE_DIR"
INFERENCE_CACHE_DIR=$(CDPATH= cd -- "$INFERENCE_CACHE_DIR" && pwd)

install_xpu() {
    if [ "$(uname -m)" != x86_64 ]; then
        echo 'Intel XPU runtime installation requires Linux x86_64.' >&2
        exit 1
    fi
    : "${IGC:=2.41.5+22716}" "${NEO:=26.35.39758.10}" "${GMM:=22.10.0}"
    if [ "$(dpkg-query -W -f='${Version} ${db:Status-Status}' intel-igc-core-2 2>/dev/null || true)" = "$IGC installed" ] \
        && [ "$(dpkg-query -W -f='${Version} ${db:Status-Status}' libigdgmm12 2>/dev/null || true)" = "$GMM installed" ] \
        && [ "$(dpkg-query -W -f='${Version} ${db:Status-Status}' libze-intel-gpu1 2>/dev/null || true)" = "$NEO-0 installed" ] \
        && [ "$(dpkg-query -W -f='${db:Status-Status}' libze1 2>/dev/null || true)" = installed ]; then
        return
    fi

    : "${APT_MIRROR:=http://deb.debian.org/debian}"
    : "${APT_SECURITY_MIRROR:=http://deb.debian.org/debian-security}"
    : "${GITHUB_RELEASE_BASE_URL:=https://github.com}"
    xpu_cache="$INFERENCE_CACHE_DIR/intel"
    mkdir -p "$xpu_cache"
    xpu_sources="$xpu_cache/sources.list"
    cat > "$xpu_sources" <<EOF
deb [signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] ${APT_MIRROR%/} trixie main
deb [signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] ${APT_MIRROR%/} trixie-updates main
deb [signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] ${APT_SECURITY_MIRROR%/} trixie-security main
EOF
    export DEBIAN_FRONTEND=noninteractive
    apt-get -o "Dir::Etc::sourcelist=$xpu_sources" -o Dir::Etc::sourceparts=- update
    apt-get -o "Dir::Etc::sourcelist=$xpu_sources" -o Dir::Etc::sourceparts=- \
        install -y --no-install-recommends curl libze1

    set --
    for xpu_url in \
        "${GITHUB_RELEASE_BASE_URL%/}/intel/intel-graphics-compiler/releases/download/v${IGC%+*}/intel-igc-core-2_${IGC}_amd64.deb" \
        "${GITHUB_RELEASE_BASE_URL%/}/intel/compute-runtime/releases/download/$NEO/libigdgmm12_${GMM}_amd64.deb" \
        "${GITHUB_RELEASE_BASE_URL%/}/intel/compute-runtime/releases/download/$NEO/libze-intel-gpu1_$NEO-0_amd64.deb"; do
        xpu_package="$xpu_cache/${xpu_url##*/}"
        if [ ! -f "$xpu_package" ]; then
            curl --fail --location --retry 3 --output "$xpu_package.part" "$xpu_url"
            mv -- "$xpu_package.part" "$xpu_package"
        fi
        set -- "$@" "$xpu_package"
    done
    apt-get -o "Dir::Etc::sourcelist=$xpu_sources" -o Dir::Etc::sourceparts=- \
        install -y --no-install-recommends --allow-downgrades "$@"
}

if [ "$TORCH" = xpu ]; then
    install_xpu
fi

python_tag=$(python3 -c 'import sys; print(sys.implementation.cache_tag)')
: "${UV_PROJECT_ENVIRONMENT:=$INFERENCE_CACHE_DIR/venvs/$python_tag-$(uname -m)-$TORCH}"
if [ ! -x "$UV_PROJECT_ENVIRONMENT/bin/python" ]; then
    uv venv --python "$(command -v python3)" "$UV_PROJECT_ENVIRONMENT"
fi

case "$TORCH" in
    cuda) : "${TORCH_INDEX_URL:=${UV_DEFAULT_INDEX:-${UV_INDEX_URL:-https://pypi.org/simple}}}" ;;
    *) : "${TORCH_INDEX_URL:=https://download.pytorch.org/whl/$TORCH}" ;;
esac
echo "Installing inference dependencies ($TORCH)..."
# Keep the index explicit: overriding it with --index would also route ordinary packages there.
runtime_project="$INFERENCE_CACHE_DIR/projects/$TORCH"
mkdir -p "$runtime_project"
escaped_index=$(printf '%s' "$TORCH_INDEX_URL" | sed 's/[\\"]/\\&/g; s/[\\&|]/\\&/g')
sed "/^name = \"pytorch-$TORCH\"$/,/^explicit = true$/s|^url = .*|url = \"$escaped_index\"|" \
    pyproject.toml > "$runtime_project/pyproject.toml"
uv pip install --python "$UV_PROJECT_ENVIRONMENT/bin/python" \
    -r "$runtime_project/pyproject.toml" --extra "$TORCH"

export VIRTUAL_ENV="$UV_PROJECT_ENVIRONMENT" PATH="$UV_PROJECT_ENVIRONMENT/bin:$PATH"
exec "$UV_PROJECT_ENVIRONMENT/bin/python" -m app.main "$@"

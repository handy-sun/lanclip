{
  description = "Lanclip cloud clipboard";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      lib = nixpkgs.lib;
      systems = [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-darwin"
        "x86_64-linux"
      ];
      forAllSystems = lib.genAttrs systems;

      cleanNodeSource =
        src:
        lib.cleanSourceWith {
          inherit src;
          filter =
            path: type:
            let
              base = baseNameOf path;
            in
            !(
              base == "node_modules"
              || base == "dist"
              || base == "static"
              || base == "history.json"
              || base == "config.json"
            );
        };
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          nodejs = pkgs.nodejs_22;

          client = pkgs.buildNpmPackage {
            pname = "lanclip-client";
            version = "0.1.0";

            src = cleanNodeSource ./client;
            inherit nodejs;

            npmDepsHash = "sha256-Y0aD5mwLvZi2OmDj6tdd/891fpKKbmtliwulKeT7nHE=";

            nativeBuildInputs = [
              pkgs.brotli
              pkgs.gzip
            ];

            buildPhase = ''
              runHook preBuild

              npm exec -- vue-cli-service build --modern

              find dist -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' -o -name '*.svg' \) \
                -exec gzip -9 -k {} \; \
                -exec brotli --best {} \;

              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall

              mkdir -p "$out/share/lanclip/static"
              cp -R dist/. "$out/share/lanclip/static/"

              runHook postInstall
            '';
          };

          server = pkgs.buildNpmPackage {
            pname = "lanclip";
            version = "1.2.0";

            src = cleanNodeSource ./server-node;
            inherit nodejs;

            npmDepsHash = "sha256-lvWjA8FrONPout8HmmxBfxIS3OmZXOcUmLd0URIfNnI=";
            dontNpmBuild = true;

            nativeBuildInputs = [
              pkgs.makeWrapper
            ];

            postInstall = ''
              appDir="$out/lib/node_modules/cloud-clipboard-server-node"

              rm -rf "$appDir/static"
              mkdir -p "$appDir/static"
              cp -R ${client}/share/lanclip/static/. "$appDir/static/"

              makeWrapper ${nodejs}/bin/node "$out/bin/lanclip" \
                --add-flags "$appDir/main.js"
            '';

            passthru = {
              inherit client;
            };
          };
        in
        {
          default = server;
          inherit client server;
        }
      );

      apps = forAllSystems (system: {
        default = {
          type = "app";
          program = "${self.packages.${system}.default}/bin/lanclip";
        };
        lanclip = self.apps.${system}.default;
      });

      devShells = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_22
              pkgs.pkg-config
              pkgs.python3
              pkgs.vips
            ];

            shellHook = ''
              echo "Lanclip dev shell"
              echo "Frontend: cd client && npm ci && npm run serve"
              echo "Backend:  cd server-node && npm ci && npm run dev"
            '';
          };
        }
      );

      formatter = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        pkgs.nixfmt
      );
    };
}

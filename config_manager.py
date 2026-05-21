import os
import json
import csv
import tempfile
import shutil
import folder_paths

class ConfigManager:
    def __init__(self):
        # Plugin directory
        self.dir_path = os.path.dirname(os.path.abspath(__file__))
        
        # Get ComfyUI user directory
        try:
            user_dir = folder_paths.get_user_directory()
            if user_dir and os.path.isdir(user_dir):
                # Use user/default/prompt-assistant as base directory
                self.base_dir = os.path.join(user_dir, "default", "prompt-assistant")
                # self._log(f"Using user config directory: {self.base_dir}")
            else:
                # Fall back to plugin directory
                self.base_dir = self.dir_path
                self._log(f"Fallback to plugin config directory: {self.base_dir}")
        except Exception as e:
            # Exception handling, fall back to plugin directory
            self.base_dir = self.dir_path
            self._log(f"Cannot get user directory ({str(e)}), using plugin config directory")
        
        # Define subdirectories
        self.config_dir = os.path.join(self.base_dir, "config")
        self.rules_dir = os.path.join(self.base_dir, "rules")
        self.tags_dir = os.path.join(self.base_dir, "tags")
        
        # Ensure directories exist
        os.makedirs(self.config_dir, exist_ok=True)
        os.makedirs(self.rules_dir, exist_ok=True)
        os.makedirs(self.tags_dir, exist_ok=True)

        # Config file paths (user config and selection)
        self.config_path = os.path.join(self.config_dir, "config.json")
        self.active_prompts_path = os.path.join(self.config_dir, "active_prompts.json")
        self.tags_user_path = os.path.join(self.config_dir, "tags_user.json")
        self.tags_selection_path = os.path.join(self.config_dir, "tags_selection.json")
        
        # Rule file paths (rule definitions and templates)
        self.system_prompts_path = os.path.join(self.rules_dir, "system_prompts.json")
        self.kontext_presets_path = os.path.join(self.rules_dir, "kontext_presets.json")

        # ---Template directory (plugin built-in)---
        self.templates_dir = os.path.join(self.dir_path, "config")
        
        # Store template version numbers (for version comparison)
        self._template_versions = {}

        # ---Load default config (from template files)---
        self.default_config = self._load_template("config", {"version": "2.0", "model_services": []})
        self.default_system_prompts = self._load_template("system_prompts", {})
        self.default_kontext_presets = self._load_template("kontext_presets", {})
        
        # ---Simple default config (no template needed, defined directly)---
        self.default_active_prompts = {
            "expand": "expand_扩写-通用",
            "vision_zh": "vision_zh_图像描述-Tag风格",
            "vision_en": "vision_en_Detail_Caption"
        }
        self.default_user_tags = {"favorites": []}
        
        # Default tag selection
        self.default_tags_selection = {"selected_file": "用户标签.csv"}



        # Execute data migration and config file initialization
        # migration_tool handles uniformly: ensure files exist -> CSV tag migration -> legacy migration -> incremental update
        self._run_migrations()

        # Validate and fix active prompts (silent mode, fix only on exception)
        self.validate_and_fix_active_prompts()

        # Validate and fix model parameter config
        self.validate_and_fix_model_params()

    # --- Data Migration ---
    def _run_migrations(self):
        """
        Execute data migration (called on demand, doesn't affect performance)
        Only imports and runs migration tool when needed
        """
        try:
            from .utils.migration_tool import run_migrations
            
            # Prepare default config data for incremental updates
            default_configs = {
                'config': self.default_config,
                'system_prompts': self.default_system_prompts,
                'active_prompts': self.default_active_prompts,
                'tags_user': self.default_user_tags,
                'kontext_presets': self.default_kontext_presets
            }
            
            # Prepare default config data for incremental updates
            default_configs = {
                'config': self.default_config,
                'system_prompts': self.default_system_prompts,
                'active_prompts': self.default_active_prompts,
                'tags_user': self.default_user_tags,
                'kontext_presets': self.default_kontext_presets
            }
            
            # Run migration
            results = run_migrations(
                plugin_dir=self.dir_path,
                user_base_dir=self.base_dir,
                logger=self._log,
                default_configs=default_configs
            )
            
            # Log migration results
            if results.get('tags_migration'):
                self._log("[User Tags.csv] data migration complete")
                
        except Exception as e:
            self._log(f"Data migration failed: {str(e)}")
            # Migration failure doesn't affect normal operation, only log

    # --- Unified log output ---
    def _log(self, msg: str):
        """Unified console log prefix"""
        from .utils.common import _ANSI_CLEAR_EOL
        print(f"\r{_ANSI_CLEAR_EOL}✨ {msg}", flush=True)

    # ---Template loading---
    def _load_template(self, template_name: str, fallback: dict = None) -> dict:
        """
        Load default config from template file
        
        Parameters:
            template_name: Template name (without extension and _template suffix)
            fallback: Fallback default value if loading fails
            
        Returns:
            Config dictionary (includes __config_version for version management)
        """
        template_path = os.path.join(self.templates_dir, f"{template_name}_template.json")
        try:
            with open(template_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                # Get version number and save for later comparison
                template_version = data.get("__config_version", "2.0")
                self._template_versions[template_name] = template_version
                return data
        except Exception as e:
            self._log(f"Loading template {template_name} failed: {str(e)}, using fallback value")
            # Ensure fallback also contains version number
            if fallback is None:
                fallback = {}
            # If fallback has no version number, add default version number
            if "__config_version" not in fallback:
                fallback = {"__config_version": "2.0", **fallback}
            self._template_versions[template_name] = "2.0"
            return fallback

    def _get_config_version(self, config: dict) -> str:
        """
        Get config version number (compatible with both old and new version fields)
        
        Version field priority:
        1. __config_version (new version field, e.g., "2.0.0")
        2. version (old version field, e.g., "2.0" or "1.0")
        3. Default returns "1.0" (no version field treated as oldest version)
        
        Returns:
            Version string, e.g., "2.0.0", "2.0", or "1.0"
        """
        # Prefer new version field
        if "__config_version" in config:
            return config["__config_version"]
        # Compatible with old version field
        return config.get("version", "1.0")
    
    def _is_v2_config(self, config: dict) -> bool:
        """
        Check if config is v2.0 or higher
        
        Returns:
        True means v2.0 or higher (1.9 also treated as v2 format, for incremental testing)
        """
        version = self._get_config_version(config)
        try:
            v_float = float(version)
            return v_float >= 1.9
        except ValueError:
            # If not a number (e.g., "2.0.0"), take major version for comparison
            major_version = version.split(".")[0]
            try:
                return int(major_version) >= 2
            except ValueError:
                return False

    # --- Note: The following methods have been migrated to migration_tool.py ---
    # - _apply_migrated_api_keys
    # - _migrate_provider_to_service
    # - _create_or_update_custom_service
    # - _match_service_by_provider
    # - _check_and_add_missing_services
    # Config file creation, migration, and incremental updates are uniformly handled by migration_tool


    def _atomic_write_json(self, file_path: str, data: dict) -> bool:
        """
        Atomic JSON file write
        
        Uses "write to temp file + atomic rename" strategy to ensure file write atomicity:
        - If write succeeds, new file replaces old file
        - If write fails or is interrupted, old file remains unchanged
        
        Parameters:
            file_path: Target file path
            data: Data dictionary to save
            
        Returns:
            bool: True on success, False on failure
        """
        temp_fd = None
        temp_path = None
        
        try:
            # ---Step 1: Write to temp file---
            # Create temp file in same directory (ensures same filesystem, rename is atomic)
            temp_fd, temp_path = tempfile.mkstemp(
                dir=os.path.dirname(file_path),
                suffix='.tmp',
                prefix='.tmp_'
            )
            
            # Write full new config to temp file
            with os.fdopen(temp_fd, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
                temp_fd = None  # File closed, avoid double close

            # ---Step 2: Atomic replacement---
            # rename operation is atomic, either succeeds or fails unchanged
            shutil.move(temp_path, file_path)
            temp_path = None  # Moved, avoid cleanup deletion
            
            return True
            
        except Exception as e:
            self._log(f"Atomic JSON write failed [{os.path.basename(file_path)}]: {str(e)}")
            return False
            
        finally:
            # Clean up temp file (if write failed)
            if temp_fd is not None:
                try:
                    os.close(temp_fd)
                except:
                    pass
            
            if temp_path is not None and os.path.exists(temp_path):
                try:
                    os.unlink(temp_path)
                except:
                    pass

    def load_config(self):
        """Load config file"""
        try:
            with open(self.config_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            self._log(f"Failed to load config file: {str(e)}")
            return self.default_config

    def save_config(self, config):
        """Save config file"""
        return self._atomic_write_json(self.config_path, config)

    def load_system_prompts(self):
        """Load system prompts config"""
        try:
            with open(self.system_prompts_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            self._log(f"Failed to load system prompts config: {str(e)}")
            return self.default_system_prompts

    def save_system_prompts(self, system_prompts):
        """Save system prompts config"""
        return self._atomic_write_json(self.system_prompts_path, system_prompts)

    def load_active_prompts(self):
        """Load active prompts config"""
        try:
            with open(self.active_prompts_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            self._log(f"Failed to load active prompts config: {str(e)}")
            return self.default_active_prompts

    def save_active_prompts(self, active_prompts):
        """Save active prompts config"""
        return self._atomic_write_json(self.active_prompts_path, active_prompts)

    def load_user_tags(self):
        """Load user tags config"""
        try:
            with open(self.tags_user_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            self._log(f"Failed to load user tags config: {str(e)}")
            return self.default_user_tags

    def save_user_tags(self, user_tags):
        """Save user tags config"""
        return self._atomic_write_json(self.tags_user_path, user_tags)

    def load_kontext_presets(self):
        """Load Kontext presets config"""
        try:
            with open(self.kontext_presets_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            self._log(f"Failed to load Kontext presets config: {str(e)}")
            return {}

    def save_kontext_presets(self, kontext_presets):
        """Save Kontext presets config"""
        return self._atomic_write_json(self.kontext_presets_path, kontext_presets)



    # --- Note: ensure_tags_csv_exists and CSV tag migration have been migrated to migration_tool.py ---



    def list_tags_files(self) -> list:
        """List all CSV files in the tags directory"""
        try:
            files = []
            for filename in os.listdir(self.tags_dir):
                if filename.endswith(".csv"):
                    files.append(filename)
            return sorted(files)
        except Exception as e:
            self._log(f"Failed to list tag files: {str(e)}")
            return []

    def load_tags_csv(self, filename: str) -> dict:
        """Load CSV tag file, return nested dict structure"""
        csv_path = os.path.join(self.tags_dir, filename)
        if not os.path.exists(csv_path):
            self._log(f"CSV file does not exist: {filename}")
            return {}
        
        # Try multiple encodings, prefer utf-8-sig (Excel default UTF-8), then gbk (Excel default ANSI), finally utf-8
        encodings = ['utf-8-sig', 'gbk', 'gb18030', 'utf-8']
        
        for encoding in encodings:
            try:
                result = {}
                with open(csv_path, "r", encoding=encoding, newline="") as f:
                    reader = csv.reader(f)
                    try:
                        header = next(reader, None)  # Skip header
                    except StopIteration:
                        return {} # Empty file
                    
                    for row in reader:
                        # Filter invalid rows
                        if not row or not any(cell.strip() for cell in row):
                            continue
                            
                        # At least two columns required: tag name, tag value
                        if len(row) < 2:
                            continue
                        
                        tag_name = row[0].strip()
                        tag_value = row[1].strip()
                        
                        if not tag_name:
                            continue
                            
                        # Category path: start from 3rd column, filter empty values
                        categories = [c.strip() for c in row[2:] if c.strip()]
                        
                        # Build nested structure
                        current = result
                        for cat in categories:
                            if cat not in current or not isinstance(current[cat], dict):
                                current[cat] = {}
                            current = current[cat]
                        
                        # Handle empty category placeholder: only create category structure, don't add tag
                        if tag_name == "__empty__" or tag_name == "__placeholder__":
                            continue
                        
                        # Add tag
                        current[tag_name] = tag_value
                
                return result
            except UnicodeDecodeError:
                continue
            except Exception as e:
                self._log(f"Failed to load CSV tags ({encoding}): {str(e)}")
                continue
        
        self._log(f"Cannot load CSV file: {filename}, all encodings tried and failed")
        return {}

    def save_tags_csv(self, filename: str, tags: dict) -> bool:
        """Save tag data to CSV file"""
        csv_path = os.path.join(self.tags_dir, filename)
        
        try:
            rows = []
            max_depth = 0
            
            def extract_tags(obj, path: list):
                nonlocal max_depth
                # Ensure obj is a dict type
                if not isinstance(obj, dict):
                    return
                
                # If empty category (empty dict), add placeholder row
                if len(obj) == 0 and path:
                    # Use __empty__ as placeholder to mark empty category
                    rows.append(["__empty__", ""] + path)
                    max_depth = max(max_depth, len(path))
                    return
                
                for key, value in obj.items():
                    if isinstance(value, str):
                        rows.append([key, value] + path)
                        max_depth = max(max_depth, len(path))
                    elif isinstance(value, dict):
                        extract_tags(value, path + [key])
            
            # Extract all tags
            extract_tags(tags, [])
            
            if not rows:
                self._log(f"Save CSV tags: data is empty")
                # If data is empty, write a file with only headers or keep current state?
                # Usually to prevent accidental deletion, if tags is empty, do nothing or clear the file.
                # Here we choose to write headers:
                with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
                    writer = csv.writer(f)
                    writer.writerow(["Tag Name", "Tag Value"])
                return True

            # Dynamically build header
            header = ["Tag Name", "Tag Value"]
            for i in range(max_depth):
                num_zh = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"]
                suffix = num_zh[i] if i < len(num_zh) else str(i + 1)
                header.append(f"Level {suffix} Category")
            
            with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
                writer = csv.writer(f)
                writer.writerow(header)
                for row in rows:
                    # Pad length to match header
                    while len(row) < len(header):
                        row.append("")
                    # Ensure row length doesn't exceed header (defensive)
                    writer.writerow(row[:len(header)])
            
            return True
        except Exception as e:
            self._log(f"Failed to save CSV tags: {str(e)}")
            return False

    def get_tags_selection(self) -> dict:
        """Get user's selected tag file"""
        try:
            if os.path.exists(self.tags_selection_path):
                with open(self.tags_selection_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            return self.default_tags_selection
        except Exception as e:
            self._log(f"Failed to read tag selection: {str(e)}")
            return self.default_tags_selection

    def save_tags_selection(self, selection: dict) -> bool:
        """Save user's selected tag file"""
        try:
            with open(self.tags_selection_path, "w", encoding="utf-8") as f:
                json.dump(selection, f, ensure_ascii=False, indent=2)
            return True
        except Exception as e:
            self._log(f"Failed to save tag selection: {str(e)}")
            return False

    def get_favorites(self) -> dict:
        """Get favorites list"""
        user_tags = self.load_user_tags()
        favorites = user_tags.get("favorites", {})
        
        # Compatibility: if it's a list, convert to dict
        if isinstance(favorites, list):
            new_favorites = {}
            for item in favorites:
                if isinstance(item, str):
                    new_favorites[item] = item
                elif isinstance(item, dict):
                    name = item.get("name", item.get("value"))
                    value = item.get("value")
                    if name and value:
                        new_favorites[name] = value
            return new_favorites
            
        return favorites

    def add_favorite(self, tag_value: str, tag_name: str = None, category: str = "Default") -> bool:
        """Add favorite"""
        try:
            user_tags = self.load_user_tags()
            favorites = user_tags.get("favorites", {})
            
            # Compatibility migration: if it's a one-dimensional {name: value} dict,
            # forced migration is not needed, but new additions will be put in a category
            # If it's a list, migrate to dict first
            if isinstance(favorites, list):
                favorites = self.get_favorites()
                
            name = tag_name if tag_name else tag_value
            
            # Use nested structure {category: {name: value}}
            if category not in favorites:
                # Check if there are old flat structure items; if so, and category is "Default", they may be mixed
                # Simple handling: if favorites only has key-value pairs and none are dicts, it's old flat format
                # But to not break old data, we only store category dicts at the top level
                # If favorites has non-dict values, it's old flat structure {name: value}
                # We'll move them to the "Default" category
                has_legacy = any(not isinstance(v, dict) for v in favorites.values())
                if has_legacy:
                    legacy_items = {k: v for k, v in favorites.items() if not isinstance(v, dict)}
                    # Clear old items
                    for k in legacy_items:
                        del favorites[k]
                    # Initialize default category
                    if "Default" not in favorites:
                        favorites["Default"] = {}
                    favorites["Default"].update(legacy_items)
                
                if category not in favorites:
                    favorites[category] = {}

            # If favorites[category] is not a dict (defensive programming), initialize as dict
            if not isinstance(favorites.get(category), dict):
                favorites[category] = {}

            favorites[category][name] = tag_value
            
            user_tags["favorites"] = favorites
            return self.save_user_tags(user_tags)
        except Exception as e:
            self._log(f"Failed to add favorite: {str(e)}")
            return False

    def remove_favorite(self, tag_value: str, category: str = None) -> bool:
        """Remove favorite"""
        try:
            user_tags = self.load_user_tags()
            favorites = user_tags.get("favorites", {})
            
            # Compatibility migration
            if isinstance(favorites, list):
                favorites = self.get_favorites()
            
            removed = False
            
            # If category is specified, only delete from that category
            if category:
                # Try direct category match (exact match)
                target_categories = [category]
                
                # If not found, try fuzzy match (handle filename suffix differences)
                if category not in favorites:
                    # e.g., category is "foo", favorites has "foo.csv" or vice versa
                    # But typically keys in favorites are already suffix-stripped
                    pass

                for cat in target_categories:
                    if cat in favorites and isinstance(favorites[cat], dict):
                        # Delete by value
                        keys_to_remove = [k for k, v in favorites[cat].items() if v == tag_value]
                        for k in keys_to_remove:
                            del favorites[cat][k]
                            removed = True
                            
                        # If the category is empty, should we remove the category key? Leave it for now.
            else:
                # No category specified, search recursively (old logic)
                # If old flat structure
                if any(not isinstance(v, dict) for v in favorites.values()):
                    keys_to_remove = [k for k, v in favorites.items() if not isinstance(v, dict) and v == tag_value]
                    for k in keys_to_remove:
                        del favorites[k]
                        removed = True
                
                # If new nested structure
                for cat, items in favorites.items():
                    if isinstance(items, dict):
                        keys_to_remove = [k for k, v in items.items() if v == tag_value]
                        for k in keys_to_remove:
                            del items[k]
                            removed = True
            
            if removed:
                user_tags["favorites"] = favorites
                return self.save_user_tags(user_tags)
                
            return True
        except Exception as e:
            self._log(f"Failed to remove favorite: {str(e)}")
            return False

    def get_system_prompts(self):
        """Get system prompts config (merge prompt definitions and active state)"""
        system_prompts = self.load_system_prompts()
        active_prompts = self.load_active_prompts()
        system_prompts['active_prompts'] = active_prompts
        return system_prompts

    def update_system_prompts(self, system_prompts):
        """Update system prompts config (only update prompt definitions)"""
        prompts_to_save = system_prompts.copy()
        if 'active_prompts' in prompts_to_save:
            del prompts_to_save['active_prompts']
        return self.save_system_prompts(prompts_to_save)

    def update_active_prompts(self, active_prompts):
        """Update all active prompts"""
        return self.save_active_prompts(active_prompts)

    def update_active_prompt(self, prompt_type, prompt_id):
        """Update a single active prompt"""
        active_prompts = self.load_active_prompts()
        active_prompts[prompt_type] = prompt_id
        return self.save_active_prompts(active_prompts)

    def get_baidu_translate_config(self):
        """Get Baidu Translate config"""
        config = self.load_config()
        return config.get("baidu_translate", self.default_config["baidu_translate"])

    def get_llm_config(self):
        """Get LLM config"""
        config = self.load_config()
        current_service_info = config.get('current_services', {}).get('llm')
        
        # Adapt old and new formats: supports string (old) and dict (new)
        if isinstance(current_service_info, str):
            # Old format: "service_id"
            current_service_id = current_service_info
            current_model_name = None
        elif isinstance(current_service_info, dict):
            # New format: {"service": "service_id", "model": "model_name"}
            current_service_id = current_service_info.get('service')
            current_model_name = current_service_info.get('model')
        else:
            # Not set
            current_service_id = None
            current_model_name = None
        
        if not current_service_id:
            # No service selected, return default structure
            return self._get_empty_llm_config()
        
        # Find the corresponding service
        service = self._get_service_by_id(current_service_id)
        if not service:
            return self._get_empty_llm_config()
        
        # Get LLM model list
        llm_models = service.get('llm_models', [])
        
        # If a model name is specified, try to find it
        target_model = None
        if current_model_name:
            target_model = next((m for m in llm_models if m.get('name') == current_model_name), None)
        
        # If the specified model is not found, use the default model or the first model
        if not target_model:
            target_model = next((m for m in llm_models if m.get('is_default')), 
                                llm_models[0] if llm_models else None)
        
        if not target_model:
            return self._get_empty_llm_config()
        
        # Get API Key directly (plain text storage)
        api_key = service.get('api_key', '')
        
        # Return config
        return {
            "provider": service.get('id', ''),  # Use service_id as provider
            "model": target_model.get('name', ''),
            "base_url": service.get('base_url', ''),
            "api_key": api_key,
            "temperature": target_model.get('temperature', 0.7),
            "max_tokens": target_model.get('max_tokens', 1000),
            "top_p": target_model.get('top_p', 0.9),
            "auto_unload": service.get('auto_unload', True) if service.get('type') == 'ollama' else None,
            "providers": {}  # v2.0 no longer uses this field
        }

    
    def _get_empty_llm_config(self):
        """Return empty LLM config"""
        return {
            "provider": "",
            "model": "",
            "base_url": "",
            "api_key": "",
            "temperature": 0.7,
            "max_tokens": 1000,
            "top_p": 0.9,
            "providers": {}
        }
    
    def _get_service_by_id(self, service_id: str) -> dict:
        """Get service config by ID"""
        config = self.load_config()
        services = config.get('model_services', [])
        for service in services:
            if service.get('id') == service_id:
                return service
        return None

    def get_vision_config(self):
        """Get vision model config"""
        config = self.load_config()
        current_service_info = config.get('current_services', {}).get('vlm')
        
        # Adapt old and new formats: supports string (old) and dict (new)
        if isinstance(current_service_info, str):
            # Old format: "service_id"
            current_service_id = current_service_info
            current_model_name = None
        elif isinstance(current_service_info, dict):
            # New format: {"service": "service_id", "model": "model_name"}
            current_service_id = current_service_info.get('service')
            current_model_name = current_service_info.get('model')
        else:
            # Not set
            current_service_id = None
            current_model_name = None
        
        if not current_service_id:
            # No service selected, return default structure
            return self._get_empty_vision_config()
        
        # Find the corresponding service
        service = self._get_service_by_id(current_service_id)
        if not service:
            return self._get_empty_vision_config()
        
        # Get VLM model list
        vlm_models = service.get('vlm_models', [])
        
        # If a model name is specified, try to find it
        target_model = None
        if current_model_name:
            target_model = next((m for m in vlm_models if m.get('name') == current_model_name), None)
        
        # If the specified model is not found, use the default model or the first model
        if not target_model:
            target_model = next((m for m in vlm_models if m.get('is_default')), 
                                vlm_models[0] if vlm_models else None)
        
        if not target_model:
            return self._get_empty_vision_config()
        
        # Get API Key directly (plain text storage)
        api_key = service.get('api_key', '')
        
        # Return config
        return {
            "provider": service.get('id', ''),  # Use service_id as provider
            "model": target_model.get('name', ''),
            "base_url": service.get('base_url', ''),
            "api_key": api_key,
            "temperature": target_model.get('temperature', 0.7),
            "max_tokens": target_model.get('max_tokens', 4096),
            "top_p": target_model.get('top_p', 0.9),
            "auto_unload": service.get('auto_unload', True) if service.get('type') == 'ollama' else None,
            "providers": {}  # v2.0 no longer uses this field
        }
    
    def _get_empty_vision_config(self):
        """Return empty vision model config"""
        return {
            "provider": "",
            "model": "",
            "base_url": "",
            "api_key": "",
            "temperature": 0.7,
            "max_tokens": 4096,
            "top_p": 0.9,
            "providers": {}
        }

    def get_translate_config(self):
        """Get translation service config (supports Baidu Translate and LLM translation)"""
        config = self.load_config()
        current_service_info = config.get('current_services', {}).get('translate')
        
        # Adapt old and new formats: supports string (old) and dict (new)
        if isinstance(current_service_info, str):
            # Old format: "service_id"
            current_service_id = current_service_info
            current_model_name = None
        elif isinstance(current_service_info, dict):
            # New format: {"service": "service_id", "model": "model_name"}
            current_service_id = current_service_info.get('service')
            current_model_name = current_service_info.get('model')
        else:
            # Not set, default to Baidu Translate
            current_service_id = 'baidu'
            current_model_name = None
        
        # Baidu Translate special handling (uses independent baidu_translate config)
        if current_service_id == 'baidu':
            baidu_config = self.get_baidu_translate_config()
            return {
                "provider": "baidu",
                "model": "",
                "base_url": "",
                "api_key": baidu_config.get('app_id', ''),
                "secret_key": baidu_config.get('secret_key', ''),
                "temperature": 0.7,
                "max_tokens": 1000,
                "top_p": 0.9,
                "providers": {}
            }
        
        # Find the corresponding LLM service
        service = self._get_service_by_id(current_service_id)
        if not service:
        # Service not found, fallback to Baidu Translate
            baidu_config = self.get_baidu_translate_config()
            return {
                "provider": "baidu",
                "model": "",
                "base_url": "",
                "api_key": baidu_config.get('app_id', ''),
                "secret_key": baidu_config.get('secret_key', ''),
                "temperature": 0.7,
                "max_tokens": 1000,
                "top_p": 0.9,
                "providers": {}
            }
        
        # Get LLM model list
        llm_models = service.get('llm_models', [])
        
        # If a model name is specified, try to find it
        target_model = None
        if current_model_name:
            target_model = next((m for m in llm_models if m.get('name') == current_model_name), None)
        
        # If the specified model is not found, use the default model or the first model
        if not target_model:
            target_model = next((m for m in llm_models if m.get('is_default')), 
                                llm_models[0] if llm_models else None)
        
        if not target_model:
            # No available models, fallback to Baidu Translate
            baidu_config = self.get_baidu_translate_config()
            return {
                "provider": "baidu",
                "model": "",
                "base_url": "",
                "api_key": baidu_config.get('app_id', ''),
                "secret_key": baidu_config.get('secret_key', ''),
                "temperature": 0.7,
                "max_tokens": 1000,
                "top_p": 0.9,
                "providers": {}
            }
        
        # Return LLM translation config
        api_key = service.get('api_key', '')
        return {
            "provider": service.get('id', ''),
            "model": target_model.get('name', ''),
            "base_url": service.get('base_url', ''),
            "api_key": api_key,
            "temperature": target_model.get('temperature', 0.7),
            "max_tokens": target_model.get('max_tokens', 1000),
            "top_p": target_model.get('top_p', 0.9),
            "auto_unload": service.get('auto_unload', True) if service.get('type') == 'ollama' else None,
            "providers": {}
        }

    def get_settings(self):
        """Get ComfyUI user settings (read from settings file)"""
        try:
            # ComfyUI settings file is usually located at user/default/comfy.settings.json
            # Need to find the ComfyUI root directory
            import sys
            
            # Try to find settings file from multiple possible paths
            possible_paths = []
            
            # Method 1: Search upward from current file path
            current_dir = os.path.dirname(os.path.abspath(__file__))
            # custom_nodes/comfyui_prompt_assistant -> custom_nodes -> ComfyUI
            comfyui_root = os.path.dirname(os.path.dirname(current_dir))
            possible_paths.append(os.path.join(comfyui_root, "user", "default", "comfy.settings.json"))
            
            # Method 2: Search via sys.path
            for path in sys.path:
                if 'ComfyUI' in path:
                    possible_paths.append(os.path.join(path, "user", "default", "comfy.settings.json"))
            
            # Try to read the settings file
            for settings_path in possible_paths:
                if os.path.exists(settings_path):
                    try:
                        with open(settings_path, 'r', encoding='utf-8') as f:
                            settings_data = json.load(f)
                            # Return settings data
                            return settings_data
                    except Exception as e:
                        self._log(f"Failed to read settings file: {settings_path}, error: {str(e)}")
                        continue
            
            # If not found, return empty dict
            return {}
            
        except Exception as e:
            # If cannot get, return empty dict
            self._log(f"Failed to get user settings: {str(e)}")
            return {}

    def update_baidu_translate_config(self, app_id=None, secret_key=None):
        """Update Baidu Translate config"""
        config = self.load_config()
        if "baidu_translate" not in config:
            config["baidu_translate"] = {}

        # Only update provided parameters
        if app_id is not None:
            config["baidu_translate"]["app_id"] = app_id
        if secret_key is not None:
            config["baidu_translate"]["secret_key"] = secret_key

        return self.save_config(config)




    # --- Note: validate_and_fix_system_prompts has been migrated to migration_tool.py ---
    # System prompts validation and completion are handled uniformly by migration_tool's incremental update logic


    def validate_and_fix_active_prompts(self):
        """
        Validate that active prompts exist, fix if they don't
        
        Note: This method only repairs active_prompts.json (switches to existing prompts)
        It will not restore deleted content in system_prompts.json (respects user deletions)
        """
        try:
            system_prompts = self.load_system_prompts()
            active_prompts = self.load_active_prompts()

            # Flag to track if active prompts need updating
            modified = False

            # Check and fix expand prompt
            if "expand" in active_prompts:
                expand_id = active_prompts["expand"]
                expand_prompts = system_prompts.get("expand_prompts", {})
                
                if expand_id not in expand_prompts:
                    # Active prompt does not exist, switch to first available
                    if expand_prompts:
                        first_expand_id = next(iter(expand_prompts))
                        active_prompts["expand"] = first_expand_id
                        self._log(f"Active expand prompt '{expand_id}' does not exist, switched to '{first_expand_id}'")
                        modified = True
                    else:
                        # No available expand prompts, clear activation
                        active_prompts["expand"] = ""
                        self._log(f"Warning: no available expand prompts")
                        modified = True

            # Check and fix Chinese caption prompt
            if "vision_zh" in active_prompts:
                vision_zh_id = active_prompts["vision_zh"]
                vision_prompts = system_prompts.get("vision_prompts", {})
                zh_prompts = {k: v for k, v in vision_prompts.items() if k.startswith("vision_zh_")}
                
                if vision_zh_id not in vision_prompts:
                    if zh_prompts:
                        first_id = next(iter(zh_prompts))
                        active_prompts["vision_zh"] = first_id
                        self._log(f"Active Chinese caption prompt '{vision_zh_id}' does not exist, switched to '{first_id}'")
                        modified = True
                    else:
                        active_prompts["vision_zh"] = ""
                        self._log(f"Warning: no available Chinese caption prompts")
                        modified = True

            # Check and fix English caption prompt
            if "vision_en" in active_prompts:
                vision_en_id = active_prompts["vision_en"]
                vision_prompts = system_prompts.get("vision_prompts", {})
                en_prompts = {k: v for k, v in vision_prompts.items() if k.startswith("vision_en_")}
                
                if vision_en_id not in vision_prompts:
                    if en_prompts:
                        first_id = next(iter(en_prompts))
                        active_prompts["vision_en"] = first_id
                        self._log(f"Active English caption prompt '{vision_en_id}' does not exist, switched to '{first_id}'")
                        modified = True
                    else:
                        active_prompts["vision_en"] = ""
                        self._log(f"Warning: no available English caption prompts")
                        modified = True

            # If update needed, save the fixed active prompts
            if modified:
                self.save_active_prompts(active_prompts)
                self._log("Active prompts validation and fix completed")

        except Exception as e:
            self._log(f"Exception validating active prompts: {str(e)}")



    def validate_and_fix_model_params(self):
        """
        Validate and fix model parameter config
        Note: In v2.0, model parameters are stored directly in each service's model objects,
        this method primarily ensures the config file exists and has the correct format
        """
        try:
            config = self.load_config()
            
            # Ensure v2.0 format
            if not self._is_v2_config(config):
                self._log("[config.json] Warning: Detected old version config, please manually create a new config file or use default config")
                return
            
            # In v2.0 format, parameters are already in each service's model list, no additional validation needed
            # If missing services or model parameters need to be filled, handle them in the service management API
            
        except Exception as e:
            self._log(f"[config.json] Error validating model parameter config: {str(e)}")


    # --- API Key security methods (Plan A) ---
    
    @staticmethod
    def mask_api_key(api_key: str) -> str:
        """
        Mask API Key, showing only the first and last parts
        Used for secure frontend display, prevents API Key from being visible in plaintext over the Network
        
        Parameters:
            api_key: Plaintext API Key
            
        Returns:
            str: Masked API Key
            
        Examples:
            - *** -> sk-abc***xyz789
            - Short Key (< 8 chars) -> ***
            - Empty string -> ""
        """
        if not api_key:
            return ""
        if len(api_key) < 8:
            return "***"
        # Show first 6 and last 4 characters
        return f"{api_key[:6]}***{api_key[-4:]}"
    
    def get_llm_config_masked(self):
        """
        Get LLM config (API Key masked version)
        Used for frontend display, does not expose the full API Key
        
        Returns:
            Dict: LLM config with api_key field masked
        """
        config = self.get_llm_config()
        
        if 'api_key' in config:
            # Mask API Key
            config['api_key_masked'] = self.mask_api_key(config['api_key'])
            config['api_key_exists'] = bool(config['api_key'])
            # Remove plaintext API Key
            del config['api_key']
        
        # Handle API Keys for all providers
        if 'providers' in config:
            for provider_name, provider_config in config['providers'].items():
                if 'api_key' in provider_config:
                    provider_config['api_key_masked'] = self.mask_api_key(provider_config['api_key'])
                    provider_config['api_key_exists'] = bool(provider_config['api_key'])
                    del provider_config['api_key']
        
        return config

    def get_vision_config_masked(self):
        """
        Get vision model config (API Key masked version)
        Used for frontend display, does not expose full API Key
        
        Returns:
            Dict: Vision model config, api_key field is masked
        """
        config = self.get_vision_config()
        
        if 'api_key' in config:
            # Mask API Key
            config['api_key_masked'] = self.mask_api_key(config['api_key'])
            config['api_key_exists'] = bool(config['api_key'])
            # Remove plaintext API Key
            del config['api_key']
        
        # Handle API Keys for all providers
        if 'providers' in config:
            for provider_name, provider_config in config['providers'].items():
                if 'api_key' in provider_config:
                    provider_config['api_key_masked'] = self.mask_api_key(provider_config['api_key'])
                    provider_config['api_key_exists'] = bool(provider_config['api_key'])
                    del provider_config['api_key']
        
        return config

    # --- Service management methods (CRUD) ---
    
    def get_all_services(self):
        """
        Get all services list
        
        Returns:
            List[Dict]: List of services
        """
        config = self.load_config()
        
        if self._is_v2_config(config):
            return config.get('model_services', [])
        else:
            # v1.0 does not support this feature
            return []
    
    def get_service(self, service_id: str):
        """
        Get the full configuration of a specified service
        
        Parameters:
            service_id: Service ID
            
        Returns:
            Dict: Service config, returns None if not found
        """
        return self._get_service_by_id(service_id)
    
    def create_service(self, service_type: str, name: str = "", base_url: str = "", 
                      api_key: str = "", description: str = ""):
        """
        Create a new service
        
        Parameters:
            service_type: Service type ('openai_compatible' or 'ollama')
            name: Service name (auto-generated if empty)
            base_url: Base URL
            api_key: API Key (plaintext storage)
            description: Description
            
        Returns:
            str: Newly created service_id, returns None on failure
        """
        try:
            config = self.load_config()
            
            if not self._is_v2_config(config):
                self._log("Failed to create service: config version too old, please migrate to v2.0 first")
                return None
            
            # Get existing service list
            current_services = config.get('model_services', [])
            
            # Generate service ID and name
            service_id, auto_name = self._generate_service_id_and_name(service_type, current_services)
            
            # If user didn't provide a name, use auto-generated name
            if not name:
                name = auto_name
            
            # Create service config
            new_service = {
                "id": service_id,
                "type": service_type,
                "name": name,
                "description": description,
                "base_url": base_url,
                "api_key": api_key or "",
                "disable_thinking": True,
                "enable_advanced_params": True,
                "filter_thinking_output": True,
                "llm_models": [],
                "vlm_models": []
            }
            
            # Ollama-specific config
            if service_type == "ollama":
                new_service["auto_unload"] = True
            
            # Add to config
            if 'model_services' not in config:
                config['model_services'] = []
            
            config['model_services'].append(new_service)
            
            # Save config
            if self.save_config(config):
                self._log(f"Successfully created service: {name} (ID: {service_id})")
                return service_id
            else:
                self._log(f"Failed to save service config: {name}")
                return None
                
        except Exception as e:
            self._log(f"Exception creating service: {str(e)}")
            import traceback
            traceback.print_exc()
            return None
    
    def _generate_service_id_and_name(self, service_type: str, current_services: list) -> tuple:
        """
        Generate service ID and default name
        
        Parameters:
            service_type: Service type
            current_services: Existing services list
            
        Returns:
            tuple: (service_id, default_name)
        """
        import random
        
        # Type mapping
        type_map = {
            "ollama": {
                "name_prefix": "Ollama Service",
                "id_prefix": "ollama"
            },
            "openai_compatible": {
                "name_prefix": "Generic Service",
                "id_prefix": "service"
            }
        }
        
        # Get type config
        type_config = type_map.get(service_type, {
            "name_prefix": "New Service",
            "id_prefix": service_type
        })
        
        name_prefix = type_config["name_prefix"]
        id_prefix = type_config["id_prefix"]
        
        # Collect used numbers
        existing_numbers = set()
        for service in current_services:
            sid = service.get('id', '')
            # Match format: {id_prefix}_{number}
            if sid.startswith(f"{id_prefix}_"):
                try:
                    num_str = sid.split('_')[-1]
                    if num_str.isdigit():
                        existing_numbers.add(int(num_str))
                except:
                    pass
        
        # Generate random 3-digit number (100-999), try at most 100 times
        max_attempts = 100
        for _ in range(max_attempts):
            random_number = random.randint(100, 999)
            if random_number not in existing_numbers:
                break
        else:
            # If all 100 attempts are duplicates, use larger random number (4 digits)
            random_number = random.randint(1000, 9999)
            while random_number in existing_numbers:
                random_number = random.randint(1000, 9999)
        
        # Generate ID and name
        service_id = f"{id_prefix}_{random_number}"
        default_name = f"{name_prefix}-{random_number}"
        
        return service_id, default_name
    
    def delete_service(self, service_id: str):
        """
        Delete a service
        
        Parameters:
            service_id: Service ID
            
        Returns:
            bool: True on success
        """
        try:
            config = self.load_config()
            
            if not self._is_v2_config(config):
                self._log("Failed to delete service: config version too old")
                return False
            
            services = config.get('model_services', [])
            
            # Find and delete service
            original_length = len(services)
            config['model_services'] = [s for s in services if s.get('id') != service_id]
            
            if len(config['model_services']) == original_length:
                self._log(f"Failed to delete service: service does not exist (ID: {service_id})")
                return False
            
            # If deleted service is the current service, clear current_services reference
            current_services = config.get('current_services', {})
            if current_services.get('llm') == service_id:
                current_services['llm'] = None
            if current_services.get('vlm') == service_id:
                current_services['vlm'] = None
            if current_services.get('translate') == service_id:
                current_services['translate'] = None
            
            # Save config
            if self.save_config(config):
                self._log(f"Successfully deleted service: {service_id}")
                return True
            else:
                self._log(f"Failed to save config")
                return False
                
        except Exception as e:
            self._log(f"Exception deleting service: {str(e)}")
            import traceback
            traceback.print_exc()
            return False

    def update_services_order(self, service_ids: list) -> bool:
        """
        Update service order

        Parameters:
            service_ids: List of service IDs in new order

        Returns:
            bool: True on success
        """
        try:
            config = self.load_config()

            if not self._is_v2_config(config):
                self._log("Failed to update service order: config version too old")
                return False

            services = config.get('model_services', [])

            # Create ID-to-service mapping
            service_map = {s.get('id'): s for s in services}

            # Verify all service_ids exist
            for service_id in service_ids:
                if service_id not in service_map:
                    self._log(f"Failed to update service order: service does not exist (ID: {service_id})")
                    return False

            # Rebuild services array in new order
            new_services = []
            for service_id in service_ids:
                new_services.append(service_map[service_id])

            # Add services not in service_ids list (prevent omissions)
            for service_id, service in service_map.items():
                if service_id not in service_ids:
                    new_services.append(service)
                    self._log(f"Warning: service {service_id} not in new order, appended to end")

            config['model_services'] = new_services

            # Save config
            if self.save_config(config):
                self._log(f"Successfully updated service order: {', '.join(service_ids)}")
                return True
            else:
                self._log("Failed to save config")
                return False

        except Exception as e:
            self._log(f"Exception updating service order: {str(e)}")
            import traceback
            traceback.print_exc()
            return False

    
    def update_service(self, service_id: str, **kwargs):
        """
        Update service configuration
        
        Parameters:
            service_id: Service ID
            **kwargs: Fields to update (name, description, base_url, api_key, auto_unload, etc.)
            
        Returns:
            bool: True on success
        """
        try:
            config = self.load_config()
            
            if not self._is_v2_config(config):
                self._log("Failed to update service: config version too old")
                return False
            
            # Find service
            services = config.get('model_services', [])
            service = None
            service_index = -1
            
            for i, s in enumerate(services):
                if s.get('id') == service_id:
                    service = s
                    service_index = i
                    break
            
            if not service:
                self._log(f"Failed to update service: service does not exist (ID: {service_id})")
                return False
            
            # Update fields
            if 'name' in kwargs:
                service['name'] = kwargs['name']
            
            if 'description' in kwargs:
                service['description'] = kwargs['description']
            
            if 'base_url' in kwargs:
                service['base_url'] = kwargs['base_url']
            
            if 'api_key' in kwargs:
                # Use plaintext API Key directly
                service['api_key'] = kwargs['api_key'] or ""
            
            if 'auto_unload' in kwargs and service.get('type') == 'ollama':
                service['auto_unload'] = kwargs['auto_unload']
            
            if 'disable_thinking' in kwargs:
                service['disable_thinking'] = kwargs['disable_thinking']
            
            if 'enable_advanced_params' in kwargs:
                service['enable_advanced_params'] = kwargs['enable_advanced_params']
            
            if 'filter_thinking_output' in kwargs:
                service['filter_thinking_output'] = kwargs['filter_thinking_output']
            
            # Update services array
            config['model_services'][service_index] = service
            
            # Save config
            if self.save_config(config):
                self._log(f"Successfully updated service: {service_id}")
                return True
            else:
                self._log(f"Failed to save config")
                return False
                
        except Exception as e:
            self._log(f"Exception updating service: {str(e)}")
            import traceback
            traceback.print_exc()
            return False
    
    def set_current_service(self, service_type: str, service_id: str, model_name: str = None):
        """
        Set the currently used service and model
        
        Parameters:
            service_type: Service type ('llm', 'vlm', or 'translate')
            service_id: Service ID
            model_name: Model name (optional, if not provided, uses the service's default model or the first model)
            
        Returns:
            bool: True on success
        """
        try:
            config = self.load_config()
            
            if not self._is_v2_config(config):
                self._log("Failed to set current service: config version too old")
                return False
            
            # ---Baidu Translate special handling---
            # Baidu Translate uses independent baidu_translate config, not in model_services
            if service_id == 'baidu':
                # Baidu Translate supports LLM service type (old compatibility) and translate service type
                if service_type not in ['llm', 'translate']:
                    self._log(f"Failed to set current service: Baidu Translate does not support {service_type} service type")
                    return False
                
                # Ensure baidu_translate config exists
                if 'baidu_translate' not in config:
                    config['baidu_translate'] = {"app_id": "", "secret_key": ""}
                
                # Ensure current_services structure exists
                if 'current_services' not in config:
                    config['current_services'] = {}
                
                # Set Baidu as current service (no model concept)
                config['current_services'][service_type] = {
                    "service": "baidu",
                    "model": ""
                }
                
                # Save config
                if self.save_config(config):
                    self._log(f"Current service switched: Baidu Translate ({service_type})")
                    return True
                else:
                    self._log("Failed to set current service: failed to save config")
                    return False
            
            # ---Other services: verify service exists---
            service = self._get_service_by_id(service_id)
            if not service:
                self._log(f"Failed to set current service: service does not exist (ID: {service_id})")
                return False
            
            # Determine model list field based on service_type
            model_list_key = f'{service_type}_models'
            if service_type == 'translate':
                model_list_key = 'llm_models'
            
            # If model_name is provided, verify model exists
            if model_name:
                model_list = service.get(model_list_key, [])
                model_exists = any(m.get('name') == model_name for m in model_list)
                
                if not model_exists:
                    self._log(f"Failed to set current service: model does not exist (model: {model_name}, service: {service_id})")
                    return False
           
            # Ensure current_services structure exists
            if 'current_services' not in config:
                config['current_services'] = {}
            
            # Get current service info (compatible with old format)
            current_info = config['current_services'].get(service_type)
            
            # Set new format for current_services
            if model_name:
                # Explicitly specified model
                config['current_services'][service_type] = {
                    "service": service_id,
                    "model": model_name
                }
            else:
                # No model specified, use default model or first model
                model_list = service.get(model_list_key, [])
                
                # If it's Baidu service, no models
                if service.get('id') == 'baidu' or service.get('type') == 'baidu':
                    config['current_services'][service_type] = {
                        "service": service_id,
                        "model": ""
                    }
                else:
                    # Find default model or first model
                    default_model = next((m for m in model_list if m.get('is_default')), 
                                        model_list[0] if model_list else None)
                    
                    if default_model:
                        config['current_services'][service_type] = {
                            "service": service_id,
                            "model": default_model.get('name', '')
                        }
                    else:
                        # No models, just set the service
                        config['current_services'][service_type] = {
                            "service": service_id,
                            "model": ""
                        }
            
            # Save config
            if self.save_config(config):
                service_name = service.get('name', service_id)
                log_model = f" | Model:{model_name}" if model_name else ""
                self._log(f"Successfully set current {service_type} service: {service_name}{log_model}")
                return True
            else:
                self._log(f"Failed to save config")
                return False
                
        except Exception as e:
            import traceback
            traceback.print_exc()
            return False
    
    # --- Model management methods ---
    
    def add_model_to_service(self, service_id: str, model_type: str, model_name: str, 
                            temperature: float = 0.7, top_p: float = 0.9, max_tokens: int = 4096):
        """Add model to service"""
        try:
            config = self.load_config()
            services = config.get('model_services', [])
            
            for i, service in enumerate(services):
                if service.get('id') == service_id:
                    model_list_key = 'llm_models' if model_type == 'llm' else 'vlm_models'
                    
                    if model_list_key not in service:
                        service[model_list_key] = []
                    
                    # Check if already exists
                    if any(m.get('name') == model_name for m in service[model_list_key]):
                        self._log(f"Model already exists: {model_name}")
                        return False
                    
                    # Add new model
                    new_model = {
                        "name": model_name,
                        "is_default": len(service[model_list_key]) == 0,
                        "temperature": temperature,
                        "top_p": top_p,
                        "max_tokens": max_tokens
                    }
                    service[model_list_key].append(new_model)
                    config['model_services'][i] = service
                    
                    if self.save_config(config):
                        self._log(f"Successfully added model: {model_name}")
                        return True
                    return False
            
            self._log(f"Service does not exist: {service_id}")
            return False
        except Exception as e:
            self._log(f"Exception adding model: {str(e)}")
            return False
    
    def delete_model_from_service(self, service_id: str, model_type: str, model_name: str):
        """Delete model from service"""
        try:
            config = self.load_config()
            services = config.get('model_services', [])
            
            for i, service in enumerate(services):
                if service.get('id') == service_id:
                    model_list_key = 'llm_models' if model_type == 'llm' else 'vlm_models'
                    
                    if model_list_key not in service:
                        return False
                    
                    original_length = len(service[model_list_key])
                    service[model_list_key] = [m for m in service[model_list_key] if m.get('name') != model_name]
                    
                    if len(service[model_list_key]) == original_length:
                        self._log(f"Model does not exist: {model_name}")
                        return False
                    
                    # If the deleted model was the default, set the first as default
                    if len(service[model_list_key]) > 0:
                        if not any(m.get('is_default') for m in service[model_list_key]):
                            service[model_list_key][0]['is_default'] = True
                    
                    config['model_services'][i] = service
                    
                    if self.save_config(config):
                        self._log(f"Successfully deleted model: {model_name}")
                        return True
                    return False
            
            self._log(f"Service does not exist: {service_id}")
            return False
        except Exception as e:
            self._log(f"Exception deleting model: {str(e)}")
            return False
    
    def set_default_model(self, service_id: str, model_type: str, model_name: str):
        """Set default model"""
        try:
            config = self.load_config()
            services = config.get('model_services', [])
            
            for i, service in enumerate(services):
                if service.get('id') == service_id:
                    model_list_key = 'llm_models' if model_type == 'llm' else 'vlm_models'
                    
                    if model_list_key not in service:
                        return False
                    
                    found = False
                    for model in service[model_list_key]:
                        if model.get('name') == model_name:
                            model['is_default'] = True
                            found = True
                        else:
                            model['is_default'] = False
                    
                    if not found:
                        self._log(f"Model does not exist: {model_name}")
                        return False
                    
                    config['model_services'][i] = service
                    
                    if self.save_config(config):
                        self._log(f"Successfully set default model: {model_name}")
                        return True
                    return False
            
            self._log(f"Service does not exist: {service_id}")
            return False
        except Exception as e:
            self._log(f"Exception setting default model: {str(e)}")
            return False
    
    def update_model_order(self, service_id: str, model_type: str, model_names: list):
        """Update model order"""
        try:
            config = self.load_config()
            services = config.get('model_services', [])
            
            for i, service in enumerate(services):
                if service.get('id') == service_id:
                    model_list_key = 'llm_models' if model_type == 'llm' else 'vlm_models'
                    
                    if model_list_key not in service:
                        return False
                    
                    # Create model dictionary
                    model_dict = {m.get('name'): m for m in service[model_list_key]}
                    
                    # Rearrange in new order
                    new_model_list = []
                    for name in model_names:
                        if name in model_dict:
                            new_model_list.append(model_dict[name])
                    
                    service[model_list_key] = new_model_list
                    config['model_services'][i] = service
                    
                    if self.save_config(config):
                        self._log(f"Successfully updated model order")
                        return True
                    return False
            
            self._log(f"Service does not exist: {service_id}")
            return False
        except Exception as e:
            self._log(f"Exception updating model order: {str(e)}")
            return False
    
    def update_model_parameter(self, service_id: str, model_type: str, model_name: str, 
                               parameter_name: str, parameter_value):
        """Update model parameter"""
        try:
            config = self.load_config()
            services = config.get('model_services', [])
            
            for i, service in enumerate(services):
                if service.get('id') == service_id:
                    model_list_key = 'llm_models' if model_type == 'llm' else 'vlm_models'
                    
                    if model_list_key not in service:
                        return False
                    
                    # Find model and update parameter
                    for model in service[model_list_key]:
                        if model.get('name') == model_name:
                            model[parameter_name] = parameter_value
                            config['model_services'][i] = service
                            
                            if self.save_config(config):
                                self._log(f"Successfully updated model parameter: {model_name}.{parameter_name} = {parameter_value}")
                                return True
                            return False
                    
                    self._log(f"Model does not exist: {model_name}")
                    return False
            
            self._log(f"Service does not exist: {service_id}")
            return False
        except Exception as e:
            self._log(f"Exception updating model parameter: {str(e)}")
            return False

# Create global config manager instance
config_manager = ConfigManager()
